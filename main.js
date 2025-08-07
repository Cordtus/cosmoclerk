const {
        Telegraf,
        Markup
} = require("telegraf");
const fs = require("fs");
const path = require("path");
const exec = require("child_process").exec;
const https = require('https');
const http = require('http');
const dns = require('dns');

const pageSize = 18;

const BOT_TOKEN = process.env.BOT_TOKEN;

const bot = new Telegraf(BOT_TOKEN);

const REPO_URL = "https://github.com/cosmos/chain-registry.git";
const REPO_DIR = path.join(__dirname, 'chain-registry1');
const STALE_HOURS = 6;
const UPDATE_INTERVAL = STALE_HOURS * 3600000; // in milliseconds

// Function to either edit an existing message or send a new one
async function editOrSendMessage(ctx, userId, message, options = {}) {
    const userAction = userLastAction[userId];
    if (userAction && userAction.messageId) {
        try {
            await ctx.telegram.editMessageText(
                userAction.chatId,
                userAction.messageId,
                null,
                message,
                options
            );
        } catch (error) {
            console.error('Error editing message:', error);
        }
    } else {
        const sentMessage = await ctx.reply(message, options);
        updateUserLastAction(userId, {
            messageId: sentMessage.message_id,
            chatId: sentMessage.chat.id
        });
    }
}

async function cloneOrUpdateRepo() {
    try {
        if (!fs.existsSync(REPO_DIR)) {
            console.log(`[${new Date().toISOString()}] Cloning repository: ${REPO_URL}`);
            await execPromise(`git clone ${REPO_URL} ${REPO_DIR}`);
            console.log(`[${new Date().toISOString()}] Repository cloned successfully.`);
        } else {
            const stats = fs.statSync(REPO_DIR);
            const hoursDiff = (new Date() - new Date(stats.mtime)) / 3600000;
            if (hoursDiff > STALE_HOURS) {
                try {
                    console.log(`Updating repository in ${REPO_DIR}`);
                    await execPromise(`git -C ${REPO_DIR} pull`);
                    console.log('Repository updated successfully.');
                } catch (updateError) {
                    console.log('Error updating repository, attempting to reset:', updateError);

                    // Reset the local branch to match the remote repository
                    await execPromise(`git -C ${REPO_DIR} fetch --all`);
                    await execPromise(`git -C ${REPO_DIR} reset --hard origin/master`);
                    await execPromise(`git -C ${REPO_DIR} pull`);
                    console.log('Repository reset and updated successfully.');
                }
            }
        }
    } catch (error) {
        console.error(`[${new Date().toISOString()}] Error in cloning or updating the repository: ${error.message}`);
    }
}

async function periodicUpdateRepo() {
  try {
    await cloneOrUpdateRepo();
  } catch (error) {
    console.log('Error during periodic repository update:', error);
  }
}

function execPromise(command) {
        return new Promise((resolve, reject) => {
                exec(command, (error, stdout, stderr) => {
                        if (error) {
                                reject(error);
                                return;
                        }
                        resolve(stdout.trim());
                });
        });
}

let userLastAction = {};
const expectedAction = {};

// Function to start the bot interaction and show the chain selection menu
async function startInteraction(ctx) {
    const userId = ctx.from.id;
    console.log(`[${new Date().toISOString()}] User ${userId} started interaction.`);

    // Reset the user's session on /start command
    resetUserSession(userId);

    // Retrieve the chain list
    const chains = await getChainList();
    const keyboard = paginateChains(chains, 0, userId, pageSize);
    ctx.reply('Type a chain name, or select from menu:', keyboard);
}

bot.start(async (ctx) => {
    await startInteraction(ctx);
});

// Reset the user session
function resetUserSession(userId) {
    updateUserLastAction(userId, null);
}

function updateUserLastAction(userId, data) {
    if (data) {
        userLastAction[userId] = {
            ...(userLastAction[userId] || {}),  // Preserve existing state
            ...data,
            timestamp: new Date()
        };
    } else {
        // Reset session data if null data is provided
        delete userLastAction[userId];
    }
}

// Cleanup function for user sessions
function cleanupUserSessions() {
    const now = new Date();
    Object.keys(userLastAction).forEach(userId => {
        // Check if the session has been inactive for more than the timeout period (e.g., 5 minutes)
        if ((now - new Date(userLastAction[userId].timestamp)) > 600000) { // 600000 ms = 10 minutes
            delete userLastAction[userId];
        }
    });
}

// Set the cleanup interval for user sessions
setInterval(cleanupUserSessions, 3600000); // Run every minute

function readFileSafely(filePath) {
    try {
        if (fs.existsSync(filePath)) {
            return JSON.parse(fs.readFileSync(filePath, 'utf8'));
        } else {
            console.error(`File not found: ${filePath}`);
            return null; // File does not exist
        }
    } catch (error) {
        console.error(`Error reading or parsing file ${filePath}: ${error}`);
        return null; // Error reading or parsing file
    }
}

async function getChainList(directory = REPO_DIR) {
    const directories = fs.readdirSync(directory, {
            withFileTypes: true
        })
        .filter(dirent => dirent.isDirectory() && /^[A-Za-z0-9]/.test(dirent.name))
        .map(dirent => dirent.name);

    // Non-case-sensitive sorting
    return directories.sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
}

async function getTestnetsList() {
    // Assuming testnets is a directory inside REPO_DIR
    const testnetsDir = path.join(REPO_DIR, 'testnets');
    if (!fs.existsSync(testnetsDir)) {
        console.log('Testnets directory does not exist.');
        return [];
    }

    const directories = fs.readdirSync(testnetsDir, { withFileTypes: true })
        .filter(dirent => dirent.isDirectory() && /^[A-Za-z0-9]/.test(dirent.name))
        .map(dirent => dirent.name); // Return just the chain name, not the path

    return directories.sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
}

const unhealthyEndpoints = new Set(); // Keep track of endpoints that are down

// Helper function to perform a simple DNS lookup to check if the host is reachable.
function isHostReachable(hostname) {
    if (!hostname) {
        console.error('isHostReachable called with invalid hostname:', hostname);
        return Promise.resolve(false);
    }
    return new Promise((resolve) => {
        const timeout = setTimeout(() => {
            console.error(`DNS lookup timeout for host: ${hostname}`);
            resolve(false);
        }, 3000); // 3 second timeout for DNS lookup

        dns.lookup(hostname, (err) => {
            clearTimeout(timeout);
            if (err) {
                console.error(`DNS lookup failed for host: ${hostname}, Error: ${err.message}`);
                resolve(false);
            } else {
                resolve(true);
            }
        });
    });
}

async function isEndpointHealthy(endpoint, isRpc) {
      // Immediately skip if endpoint starts with 'http://'
  if (endpoint.startsWith('http://') || unhealthyEndpoints.has(endpoint)) {
    console.log(`Skipping health check for endpoint with non-secure protocol or known to be unhealthy: ${endpoint}`);
    return false;
  }

    if (!await isHostReachable(new URL(endpoint).hostname)) {
        console.log(`${endpoint} is not reachable.`);
        return false;
    }

  // Extract hostname without protocol for reachability check
  const hostname = new URL(endpoint).hostname;

  // Check if the host is reachable
  const isReachable = await isHostReachable(hostname);
  if (!isReachable) {
    console.log(`Host ${hostname} is not reachable.`);
    unhealthyEndpoints.add(endpoint);
    return false;
  }

  // Construct the correct URL avoiding double slashes
  const basePath = isRpc ? '/status' : '/cosmos/base/tendermint/v1beta1/blocks/latest';
  const url = new URL(basePath, endpoint.replace(/([^:]\/)\/+/g, "$1")).href; // Regex to replace double slashes except after the colon of http:

  const protocol = endpoint.startsWith('https') ? https : http;
  const requestTimeout = 5000; // Reduced timeout

  return new Promise((resolve) => {
    const request = protocol.get(url, (resp) => {
      let data = '';

      resp.on('data', (chunk) => {
        data += chunk;
      });

      resp.on('end', () => {
        try {
          const jsonData = JSON.parse(data);
          let latestBlockTimeString;

          if (isRpc) {
            latestBlockTimeString = jsonData.result?.sync_info?.latest_block_time || jsonData.sync_info?.latest_block_time;
          } else {
            latestBlockTimeString = jsonData.block?.header?.time;
          }

          if (!latestBlockTimeString) {
            console.error(`Failed to find block time in the response from ${endpoint}`);
            unhealthyEndpoints.add(endpoint);
            resolve(false);
            return;
          }

          const latestBlockTime = new Date(latestBlockTimeString);
          const now = new Date();
          const timeDiff = now - latestBlockTime;

          resolve(timeDiff < 60000); // true if less than 60 seconds old
        } catch (e) {
          console.error(`Error parsing JSON response from ${endpoint}: ${e.message}`);
          unhealthyEndpoints.add(endpoint);
          resolve(false);
        }
      });
    }).on("error", (err) => {
      console.error(`Error with endpoint ${endpoint}: ${err.message}`);
      unhealthyEndpoints.add(endpoint);
      resolve(false);
    });

    request.setTimeout(requestTimeout, () => {
      request.abort();
      console.error(`Request to endpoint ${endpoint} timed out`);
      unhealthyEndpoints.add(endpoint);
      resolve(false);
    });
  });
}

// When an endpoint recovers, remove it from the unhealthy set
function recoverEndpoint(endpoint) {
    unhealthyEndpoints.delete(endpoint);
}

// Periodically clear the unhealthy endpoints set
setInterval(() => {
    unhealthyEndpoints.clear();
}, 60000); // Clear every minute

async function findHealthyEndpointOfType(chainData, type) {
    const endpoints = chainData.apis[type] || [];
    const maxTime = 15000; // 15 seconds total timeout
    const startTime = Date.now();
    
    for (const endpoint of endpoints) {
        if (Date.now() - startTime > maxTime) {
            console.log(`Timeout reached while checking ${type} endpoints`);
            break;
        }
        
        try {
            if (await isEndpointHealthy(endpoint.address, type === 'rpc')) {
                return endpoint.address;
            }
        } catch (error) {
            console.error(`Error checking endpoint ${endpoint.address}:`, error);
        }
    }
    return "Unknown";
}

async function chainInfo(ctx, chain) {
    try {
        const userId = ctx.from.id;
        const userAction = userLastAction[userId];
        const directory = userAction.browsingTestnets ? path.join(REPO_DIR, 'testnets', chain) : path.join(REPO_DIR, chain);

        const assetListPath = path.join(directory, 'assetlist.json');
        const chainJsonPath = path.join(directory, 'chain.json');

        const assetData = readFileSafely(assetListPath);
        const chainData = readFileSafely(chainJsonPath);

        if (!assetData || !chainData) {
            // Handle missing or invalid data appropriately
            return `Error: Data file for ${chain} is missing or invalid. Please check the server logs for details.`;
        }

        const baseDenom = chainData.staking?.staking_tokens[0]?.denom || "Unknown";

        const nativeDenomExponent = assetData.assets[0]?.denom_units.slice(-1)[0];
        const decimals = nativeDenomExponent ? nativeDenomExponent.exponent : "Unknown";

            async function findHealthyEndpoint(endpoints, isRpc) {
                for (const endpoint of endpoints) {
                    const healthy = await isEndpointHealthy(endpoint.address, isRpc, ctx);

                    if (healthy) {
                        return endpoint.address;
                    }
                }
                return "Unknown"; // Return Unknown if no healthy endpoint found
            }

        // Use findHealthyEndpointOfType for RPC, REST, and GRPC
        const rpcAddress = await findHealthyEndpointOfType(chainData, 'rpc');
        const restAddress = await findHealthyEndpointOfType(chainData, 'rest');

        const grpcAddress = chainData.apis?.grpc?.find(api => api.address)?.address || "Unknown";

        // Function to prefer explorer based on first character, ignoring URL prefixes
        function findPreferredExplorer(explorers) {
            if (!explorers || explorers.length === 0) return null;

            // Strip common prefixes for comparison purposes
            function stripPrefixes(name) {
                return name.replace(/^(http:\/\/|https:\/\/)?(www\.)?/, '');
            }

            // Sort explorers by preference: 'c', 'm', then any
            const preferredOrder = ['c', 'm'];
            const sortedExplorers = explorers
                .map(explorer => {
                    return {
                        kind: explorer.kind,
                        url: explorer.url,
                        compareUrl: stripPrefixes(explorer.url)
                    };
                })
                .sort((a, b) => {
                    for (const letter of preferredOrder) {
                        if (a.compareUrl.startsWith(letter) && b.compareUrl.startsWith(letter)) {
                            return a.compareUrl.localeCompare(b.compareUrl);
                        }
                    }
                    if (a.compareUrl.startsWith(preferredOrder[0])) return -1;
                    if (b.compareUrl.startsWith(preferredOrder[0])) return 1;
                    if (a.compareUrl.startsWith(preferredOrder[1])) return -1;
                    if (b.compareUrl.startsWith(preferredOrder[1])) return 1;
                    return a.compareUrl.localeCompare(b.compareUrl);
                });

            return sortedExplorers.length > 0 ? sortedExplorers[0].url : "Unknown";
        }

       const blockExplorerUrl = findPreferredExplorer(chainData.explorers) || "Unknown";

        const message = `Chain ID: \`${chainData.chain_id}\`\n` +
            `Chain Name: \`${chainData.chain_name}\`\n` +
            `RPC: \`${rpcAddress}\`\n` +
            `REST: \`${restAddress}\`\n` +
            `Address Prefix: \`${chainData.bech32_prefix}\`\n` +
            `Base Denom: \`${baseDenom}\`\n` +
            `Cointype: \`${chainData.slip44}\`\n` +
            `Decimals: \`${decimals}\`\n` +
            `Block Explorer: \`${blockExplorerUrl}\``;

        // Return an object with both message and data
        return {
            message: message,
            data: {
                rpcAddress,
                restAddress,
                grpcAddress
            }
        };
    } catch (error) {
        console.error(`[${new Date().toISOString()}] Error fetching data for ${chain}: ${error.stack}`);
        return `Error fetching data for ${chain}: ${error.message}. Please contact the developer or open an issue on GitHub.`;
    }
}

async function chainEndpoints(ctx, chain) {
    console.log(`[${new Date().toISOString()}] Fetching endpoints for ${chain}`);
    try {
        const userId = ctx.from.id;
        const userAction = userLastAction[userId];
        const directory = userAction.browsingTestnets ? path.join(REPO_DIR, 'testnets', chain) : path.join(REPO_DIR, chain);
        const chainJsonPath = path.join(directory, 'chain.json');
        const chainData = readFileSafely(chainJsonPath);

        if (!chainData) {
            console.log(`Error: Data file for ${chain} is missing or invalid.`);
            await ctx.reply(`Error fetching endpoints for ${chain}. Data file is missing or invalid.`);
            return;
        }

        const formatService = (service) => {
            const provider = `*${service.provider.replace(/[^\w\s.-]/g, '').replace(/\./g, '_')}*`;
            const address = `\`${service.address.replace(/\/$/, '').replace(/_/g, '\\_')}\``;
            return `${provider}:\n${address}\n`;
        };

        const formatEndpoints = (services, title, maxEndpoints) => {
            if (!services || services.length === 0) {
                return `*${title}*\nNo data available\n`;
            }
            return services.slice(0, maxEndpoints).map(formatService).join("\n");
        };

        let responseSections = [
            `*RPC*\n---\n${formatEndpoints(chainData.apis.rpc, "RPC", 5)}`,
            `*REST*\n---\n${formatEndpoints(chainData.apis.rest, "REST", 5)}`,
            `*GRPC*\n---\n${formatEndpoints(chainData.apis.grpc, "GRPC", 5)}`
        ];

        if (chainData.apis['evm-http-jsonrpc']) {
            responseSections.push(`*EVM-HTTP-JSONRPC*\n---\n${formatEndpoints(chainData.apis['evm-http-jsonrpc'], "EVM-HTTP-JSONRPC", 5)}`);
        }

        let response = responseSections.filter(section => section !== "*RPC*\n---\nNo data available\n" && section !== "*REST*\n---\nNo data available\n" && section !== "*GRPC*\n---\nNo data available\n" && section !== "*EVM-HTTP-JSONRPC*\n---\nNo data available\n").join("\n\n").trim();

        console.log(`Response to be sent: ${response.substring(0, 50)}...`); // Log a preview of the response

        // Send the response, handle message length exceeding Telegram's limit if necessary
        if (response.length > 4096) {
            console.log('Response is too long, sending in parts.');
            // Define or use the splitIntoParts function here if necessary
        } else {
            await ctx.replyWithMarkdown(response);
        }
    } catch (error) {
        console.error(`[${new Date().toISOString()}] Error fetching endpoints for ${chain}: ${error.message}`, error.stack);
        await ctx.reply(`Error fetching endpoints for ${chain}. Please try again.`);
    }
}

async function chainPeerNodes(ctx, chain) {
    try {
    const userId = ctx.from.id;
    const userAction = userLastAction[userId];
    const directory = userAction.browsingTestnets ? path.join(REPO_DIR, 'testnets', chain) : path.join(REPO_DIR, chain);
    const chainJsonPath = path.join(directory, 'chain.json');
    const chainData = JSON.parse(fs.readFileSync(chainJsonPath, 'utf8'));

        const sanitizeProvider = (provider) => {
            if (!provider) return 'unnamed';
            // Remove special characters and replace periods with underscores
            return provider.replace(/[^\w\s.-]/g, '').replace(/\./g, '_');
        };

        const formatPeers = (peers, title) => {
            if (!peers || peers.length === 0) return `*${title}*\nNo data available\n\n`;
            const formattedPeers = peers.map(peer => {
                const provider = `*${sanitizeProvider(peer.provider)}*`;
                const id = peer.id ? `id: \`${peer.id}\`` : 'id: unavailable';
                const address = peer.address ? `URL: \`${peer.address}\`` : 'URL: unavailable';
                return `\n${provider}:\n ${id}\n ${address}`;
            }).join("\n");
           return `*${title}*\n${'-'.repeat(title.length)}\n${formattedPeers}\n\n`;

        };

        const seedsHeader = "Seed Nodes";
        const peersHeader = "Peer Nodes";
        const seeds = formatPeers(chainData.peers.seeds, seedsHeader);
        const persistentPeers = formatPeers(chainData.peers.persistent_peers, peersHeader);

        return `${seeds}${persistentPeers}`;
    } catch (error) {
        console.log(`Error fetching peer nodes for ${chain}:`, error.message);
        return `Error fetching peer nodes for ${chain}. Please contact developer...`;
    }
}

function sanitizeUrl(url) {
    // Escape special MarkdownV2 characters
    return url.replace(/[()]/g, '\\$&'); // Add more characters if needed
}

async function chainBlockExplorers(ctx, chain) {
    try {
        const userId = ctx.from.id;
        const userAction = userLastAction[userId];
        const directory = userAction.browsingTestnets ? path.join(REPO_DIR, 'testnets', chain) : path.join(REPO_DIR, chain);
        const chainJsonPath = path.join(directory, 'chain.json');
        const chainData = JSON.parse(fs.readFileSync(chainJsonPath, 'utf8'));

        const explorersList = chainData.explorers
            .map(explorer => {
        const name = `*${explorer.kind.replace(/[^\w\s.-]/g, '').replace(/\./g, '_')}*`;
        // Enclose address in backticks and escape underscores
        const url = `\`${explorer.url.replace(/\/$/, '').replace(/_/g, '\\_')}\``;
        return `${name}:\n${url}\n`;
            })
            .join('\n');
        return explorersList;
    } catch (error) {
        console.log(`Error fetching block explorers for ${chain}:`, error.message);
        return `Error fetching block explorers for ${chain}. Please contact developer or open an issue on Github.`;
    }
}

async function preprocessAndFormatIncentives(ctx, incentivesData, chain) {
    for (const incentive of incentivesData.data) {
        for (const coin of incentive.coins) {
            if (coin.denom.startsWith('ibc/')) {
                const ibcId = coin.denom.split('/')[1];
                // Assuming queryIbcId has been adjusted to return data when needed
                try {
                    const baseDenom = await queryIbcId(ctx, ibcId, chain, true); // Use the modified version
                    coin.denom = baseDenom || coin.denom;
                } catch (error) {
                    console.error('Error translating IBC denom:', coin.denom, error);
                }
            }
        }
    }

    // Now that all IBC denominations have been translated, format the response.
    return formatPoolIncentivesResponse(incentivesData);
}

/// Modify queryIbcId to allow for a returnable response or direct reply based on `returnBaseDenom`
async function queryIbcId(ctx, ibcId, chain, returnBaseDenom = false) {
    const chainInfoResult = await chainInfo(ctx, chain);
    if (!chainInfoResult || !chainInfoResult.data || !chainInfoResult.data.restAddress) {
        if (returnBaseDenom) return ''; // Return empty string for further processing
        ctx.reply('Error: REST address not found for the selected chain.');
        return;
    }

    let restAddress = chainInfoResult.data.restAddress.replace(/\/+$/, '');
    const url = `${restAddress}/ibc/apps/transfer/v1/denom_traces/${ibcId}`;
    try {
        const response = await fetch(url);
        const data = await response.json();

        if (returnBaseDenom) {
            if (data.denom_trace) {
                return `Path: ${data.denom_trace.path}\nBase Denomination: ${data.denom_trace.base_denom}`;
            } else {
                return `Base Denomination: ${ibcId}`;
            }
        } else {
            ctx.reply(`IBC Denom Trace: \n${JSON.stringify(data.denom_trace, null, 2)}`);
        }
    } catch (error) {
        console.error('Error fetching IBC denom trace:', error);
        if (returnBaseDenom) return ''; // Return empty string for further processing
        ctx.reply('Error fetching IBC denom trace. Please try again.');
    }
}


// Function to handle main menu actions based on user selection
async function handleMainMenuAction(ctx, action, chain) {
    const userId = ctx.from.id;
    const userAction = userLastAction[userId];

    if (!userAction || !userAction.chain) {
        await ctx.reply('No chain selected. Please select a chain first.');
        return;
    }

    try {
        switch (action) {
            case 'chain_info':
                const chainInfoResult = await chainInfo(ctx, userAction.chain);
                if (chainInfoResult && chainInfoResult.message) {
                    await ctx.reply(chainInfoResult.message, {
                        parse_mode: 'Markdown',
                        disable_web_page_preview: true,
                        reply_markup: createFollowUpKeyboard().reply_markup
                    });
                } else {
                    console.error('Unexpected result from chainInfo:', chainInfoResult);
                    await ctx.reply('Failed to fetch chain info.');
                }
                break;
            case 'peer_nodes':
                const peerNodesMessage = await chainPeerNodes(ctx, userAction.chain);
                await ctx.reply(peerNodesMessage, { 
                    parse_mode: 'Markdown',
                    reply_markup: createFollowUpKeyboard().reply_markup
                });
                break;
            case 'endpoints':
                const endpointsMessage = await chainEndpoints(ctx, userAction.chain);
                await ctx.reply(endpointsMessage, {
                    parse_mode: 'Markdown',
                    disable_web_page_preview: true,
                    reply_markup: createFollowUpKeyboard().reply_markup
                });
                break;

            case 'block_explorers':
                const blockExplorersMessage = await chainBlockExplorers(ctx, userAction.chain);
                await ctx.reply(blockExplorersMessage, {
                    parse_mode: 'Markdown',
                    disable_web_page_preview: true,
                    reply_markup: createFollowUpKeyboard().reply_markup
                });
                break;
            case 'ibc_id':
                await ctx.reply(`Enter IBC denom for ${userAction.chain}:`, { parse_mode: 'Markdown' });
                expectedAction[userId] = 'awaiting_ibc_denom';
                break;
            default:
                await ctx.reply('Invalid option selected. Please try again.');
                break;

                    }
    } catch (error) {
        console.error(`Error handling action ${action}:`, error);
        await ctx.reply(`An error occurred while processing your request: ${error.message}`);
    }
}




function sendMainMenu(ctx, userId) {
    const userAction = userLastAction[userId];
    const mainMenuButtons = [
        Markup.button.callback('1. Chain Info', 'chain_info'),
        Markup.button.callback('2. Peer Nodes', 'peer_nodes'),
        Markup.button.callback('3. Endpoints', 'endpoints'),
        Markup.button.callback('4. Block Explorers', 'block_explorers')
    ];

    // Add IBC-ID button only for mainnet chains
    if (!userAction.browsingTestnets) {
        mainMenuButtons.push(Markup.button.callback('5. IBC-ID', 'ibc_id'));
    }

    // Add back button to return to network selection
    mainMenuButtons.push(Markup.button.callback('← Back to Networks', 'back_to_networks'));

    return Markup.inlineKeyboard(mainMenuButtons, { columns: 2 });
}

// Function to create follow-up keyboard after action results
function createFollowUpKeyboard() {
    return Markup.inlineKeyboard([
        [Markup.button.callback('← Back to Networks', 'back_to_networks')],
        [Markup.button.callback('↩️ Back to Actions', 'back_to_actions')]
    ]);
}

function paginateChains(chains, currentPage, userId, pageSize) {
    console.log(`Paginating chains. Total chains: ${chains.length}, Current page: ${currentPage}, Page size: ${pageSize}`);

    const totalPages = Math.ceil(chains.length / pageSize);
    const start = currentPage * pageSize;
    const end = start + pageSize;
    const chainsToShow = chains.slice(start, end);
    const lastSelectedChain = userLastAction[userId]?.chain;
    const browsingTestnets = userLastAction[userId]?.browsingTestnets || false;

    // Log the chains that should be shown on the current page
    console.log(`Chains to show on page ${currentPage}:`, chainsToShow);

    // Create buttons and highlight the last selected one
    const buttons = chainsToShow.map(chain => {
        const isSelected = chain === lastSelectedChain;
        const buttonText = isSelected ? `🔴 ${chain}` : chain;
        return Markup.button.callback(buttonText, `select_chain:${chain}`);
    });

    const rowsOfButtons = [];
    for (let i = 0; i < buttons.length; i += 3) {
        rowsOfButtons.push(buttons.slice(i, i + 3));
    }

    const navigationButtons = [];
    if (currentPage > 0) {
        navigationButtons.push(Markup.button.callback('← Previous', `page:${currentPage - 1}`));
    }
    if (currentPage < totalPages - 1) {
        navigationButtons.push(Markup.button.callback('Next →', `page:${currentPage + 1}`));
    }

    if (navigationButtons.length > 0) {
        rowsOfButtons.push(navigationButtons);
    }

    // Add mainnet/testnet toggle button
    const toggleButton = browsingTestnets ? 
        Markup.button.callback('↩️ Switch to Mainnet', 'switch_to_mainnet') :
        Markup.button.callback('🧪 Switch to Testnet', 'switch_to_testnet');
    rowsOfButtons.push([toggleButton]);

    // Generate the keyboard markup to return
    const keyboardMarkup = Markup.inlineKeyboard(rowsOfButtons);

    // Debugging: Log the generated keyboardMarkup
    console.log(`Generated keyboardMarkup for page ${currentPage}:`, JSON.stringify(keyboardMarkup));

    // Error check for empty keyboard
    if (rowsOfButtons.length === 0) {
        console.log('No buttons generated for keyboardMarkup');
    }

    return keyboardMarkup;
}

async function showTestnets(ctx, userId) {
    const testnetsList = await getTestnetsList(); // Implement this function as shown earlier
    const keyboardMarkup = paginateChains(testnetsList, 0, userId, 18); // Assuming a page size of 18
    await ctx.reply('Select a testnet:', keyboardMarkup);
}

bot.action(/^select_chain:(.+)$/, async (ctx) => {
    const chain = ctx.match[1];
    const userId = ctx.from.id;
    const userAction = userLastAction[userId] || {};

    // Store the selected chain and whether it's a testnet
    updateUserLastAction(userId, {
        chain: chain,
        messageId: ctx.callbackQuery.message.message_id,
        chatId: ctx.callbackQuery.message.chat.id,
        browsingTestnets: userAction.browsingTestnets || false
    });

    // Show the main menu for the selected chain
    const keyboardMarkup = sendMainMenu(ctx, userId);
    await ctx.editMessageText('Select an action:', {
        parse_mode: 'Markdown',
        disable_web_page_preview: true,
        reply_markup: keyboardMarkup.reply_markup,
        chat_id: ctx.callbackQuery.message.chat.id,
        message_id: ctx.callbackQuery.message.message_id
    });
});

async function resetSessionAndShowChains(ctx) {
    const userId = ctx.from.id;
    // Clear the user's last action and expected action
    delete userLastAction[userId];
    delete expectedAction[userId];

    // Fetch the updated chain list
    const chains = await getChainList();

    // Call paginateChains with the chains, default to the first page (0), pass the userId and pageSize
    const keyboard = paginateChains(chains, 0, userId, pageSize);

    // Send the chain selection message along with the generated keyboard markup
    await ctx.reply('Please select a chain:', keyboard);
}

bot.command('restart', async (ctx) => {
    await resetSessionAndShowChains(ctx);
});

bot.command(['mainnet', 'mainnets'], async (ctx) => {
    const userId = ctx.from.id;
    const chains = await getChainList();
    updateUserLastAction(userId, { browsingTestnets: false });
    const keyboard = paginateChains(chains, 0, userId, pageSize);
    await ctx.reply('Mainnet chains:', keyboard);
});

bot.command(['testnet', 'testnets'], async (ctx) => {
    const userId = ctx.from.id;
    const testnetsList = await getTestnetsList();
    updateUserLastAction(userId, { browsingTestnets: true });
    const keyboard = paginateChains(testnetsList, 0, userId, pageSize);
    await ctx.reply('Testnet chains:', keyboard);
});

bot.action('ibc_id', async (ctx) => {
    const userId = ctx.from.id;
    const userAction = userLastAction[userId];
    if (userAction && userAction.chain) {
        // Delete the menu message to reduce clutter
        try {
            await ctx.deleteMessage();
        } catch (error) {
            console.error('Error deleting menu message:', error);
        }
        // Send a new message prompting for input
        await ctx.reply(`Enter IBC denom for ${userAction.chain}:`);
        expectedAction[userId] = 'awaiting_ibc_denom';
    } else {
        await ctx.reply('No chain selected. Please select a chain first.');
    }
});



bot.on('text', async (ctx) => {
    const text = ctx.message.text.trim().toLowerCase();
    const userId = ctx.from.id;

    if (!userLastAction[userId]) {
        userLastAction[userId] = {}; // Initialize if not exist
    }

    const userAction = userLastAction[userId];
    if (text === '/start' || text === '/restart') {
        await resetSessionAndShowChains(ctx);
    //  'awaiting_ibc_denom' expected action
    } else if (expectedAction[userId] === 'awaiting_ibc_denom') {
        if (text.startsWith('ibc/')) {
            const ibcHash = text.slice(4);
            if (userAction && userAction.chain) {
                const baseDenom = await queryIbcId(ctx, ibcHash, userAction.chain, true);
                if (baseDenom) {
                    await ctx.reply(`Base Denomination: ${baseDenom}`, {
                        reply_markup: createFollowUpKeyboard().reply_markup
                    });
                } else {
                    await ctx.reply('Failed to fetch IBC denom trace or it does not exist.', {
                        reply_markup: createFollowUpKeyboard().reply_markup
                    });
                }
            }
        } else {
            await ctx.reply('Please enter a valid IBC denom (format: ibc/HASH)', {
                reply_markup: createFollowUpKeyboard().reply_markup
            });
        }
        delete expectedAction[userId];
    } else if (!isNaN(text)) {
        // Numeric input for menu selection
        const optionIndex = parseInt(text) - 1;
        const mainMenuOptions = ['chain_info', 'peer_nodes', 'endpoints', 'block_explorers', 'ibc_id'];
        console.log(`User selected menu option number: ${optionIndex + 1}`);
        if (optionIndex >= 0 && optionIndex < mainMenuOptions.length) {
            const action = mainMenuOptions[optionIndex];
            console.log(`Mapped user input to action: ${action}`);
            if (userAction && userAction.chain) {
                await handleMainMenuAction(ctx, action, userAction.chain);
            } else {
                await ctx.reply('No chain selected. Please select a chain first.');
            }
        } else {
            await ctx.reply('Invalid option number. Please try again.');
        }
    } else if (text.startsWith('ibc/')) {
        // Handle direct IBC denom input
        const ibcHash = text.slice(4);
        if (userAction && userAction.chain) {
            const baseDenom = await queryIbcId(ctx, ibcHash, userAction.chain, true);
            if (baseDenom) {
                await ctx.reply(`Base Denomination: ${baseDenom}`, {
                    reply_markup: createFollowUpKeyboard().reply_markup
                });
            } else {
                await ctx.reply('Failed to fetch IBC denom trace or it does not exist.', {
                    reply_markup: createFollowUpKeyboard().reply_markup
                });
            }
        } else {
            await ctx.reply('No chain selected. Please select a chain first.');
        }
    } else {
        // Check if it's a chain name from mainnet or testnet
        const mainnetChains = await getChainList();
        const testnetChains = await getTestnetsList();
        
        // Check mainnet chains first
        const mainnetChainIndex = mainnetChains.findIndex(chain => chain.toLowerCase() === text);
        const testnetChainIndex = testnetChains.findIndex(chain => chain.toLowerCase() === text);
        
        if (mainnetChainIndex !== -1) {
            // Store the actual chain name with proper case
            const actualChainName = mainnetChains[mainnetChainIndex];
            updateUserLastAction(userId, { chain: actualChainName, browsingTestnets: false });
            const keyboardMarkup = sendMainMenu(ctx, userId);
            await ctx.reply(`Selected chain: ${actualChainName}\nSelect an action:`, keyboardMarkup);
        } else if (testnetChainIndex !== -1) {
            // Store the actual chain name with proper case
            const actualChainName = testnetChains[testnetChainIndex];
            updateUserLastAction(userId, { chain: actualChainName, browsingTestnets: true });
            const keyboardMarkup = sendMainMenu(ctx, userId);
            await ctx.reply(`Selected chain: ${actualChainName}\nSelect an action:`, keyboardMarkup);
        } else {
            // Fallback for unrecognized commands
            await ctx.reply('Unrecognized command. Please try again or use the menu options.');
        }
    }
});

bot.action(/page:(\d+)/, async (ctx) => {
    console.log("Page action triggered", ctx);
    try {
        const page = parseInt(ctx.match[1]);
        console.log(`Page requested: ${page}`);

        const userId = ctx.from.id;
        const userAction = userLastAction[userId] || {};
        
        // Get the appropriate chain list based on whether user is browsing testnets
        let chains;
        if (userAction.browsingTestnets) {
            chains = await getTestnetsList();
        } else {
            chains = await getChainList();
        }
        
        console.log(`Total chains retrieved: ${chains.length}`);

        if (!chains.length) {
            console.log('No chains available');
            return ctx.reply('No chains available.');
        }

        if (page < 0 || page >= Math.ceil(chains.length / pageSize)) {
            console.log(`Invalid page number: ${page}`);
            return ctx.reply('Invalid page number.');
        }

        // Pass the pageSize to paginateChains
        const keyboard = paginateChains(chains, page, userId, pageSize);

        console.log(`Generated keyboardMarkup for page ${page}:`, JSON.stringify(keyboard.reply_markup));

        if (!keyboard.reply_markup || keyboard.reply_markup.inline_keyboard.length === 0) {
            console.log('Generated keyboard is empty or invalid');
            return ctx.reply('Unable to generate navigation buttons.');
        }

        // Get the message ID from the callback query
        const messageId = ctx.callbackQuery.message.message_id;
        const chatId = ctx.callbackQuery.message.chat.id;

        // Edit previous message instead of sending new
        await ctx.editMessageReplyMarkup({
            inline_keyboard: keyboard.reply_markup.inline_keyboard,
            chat_id: chatId,
            message_id: messageId
        });
    } catch (error) {
        console.error(`Error in page action: ${error}`);
        await ctx.reply('An error occurred while processing your request.');
    }
});

bot.action('chain_info', async (ctx) => {
    const userId = ctx.from.id;
    const userAction = userLastAction[userId];
    if (userAction && userAction.chain) {
        const chainInfoResult = await chainInfo(ctx, userAction.chain);
        if (chainInfoResult && chainInfoResult.message) {
            // Delete the menu message to reduce clutter
            try {
                await ctx.deleteMessage();
            } catch (error) {
                console.error('Error deleting menu message:', error);
            }
            // Send a new message with the chain info and follow-up keyboard
            await ctx.reply(chainInfoResult.message, {
                parse_mode: 'Markdown',
                disable_web_page_preview: true,
                reply_markup: createFollowUpKeyboard().reply_markup
            });
        } else {
            console.error('Unexpected result from chainInfo:', chainInfoResult);
            await ctx.reply('Failed to fetch chain info.');
        }
    } else {
        await ctx.reply('No chain selected. Please select a chain first.');
    }
});

bot.action('endpoints', async (ctx) => {
    const userId = ctx.from.id;
    const userAction = userLastAction[userId];
    if (userAction && userAction.chain) {
        const endpoints = await chainEndpoints(ctx, userAction.chain);

        if (!endpoints || typeof endpoints !== 'string' || !endpoints.trim()) {
            console.error(`Endpoints data is unexpectedly empty for chain ${userAction.chain}.`);
            await ctx.reply('Error: Received unexpectedly empty data.');
            return; // Ensure to return here to prevent further execution
        }

        console.log('Formatted Endpoints:', endpoints);
        try {
            // Delete the menu message to reduce clutter
            try {
                await ctx.deleteMessage();
            } catch (error) {
                console.error('Error deleting menu message:', error);
            }
            // Send a new message with the endpoints and follow-up keyboard
            await ctx.reply(endpoints, { 
                parse_mode: 'Markdown',
                disable_web_page_preview: true,
                reply_markup: createFollowUpKeyboard().reply_markup
            });
        } catch (error) {
            console.error('Error sending endpoints:', error);
            await ctx.reply('An error occurred while sending the endpoints. Please try again.');
        }
    } else {
        await ctx.reply('No chain selected. Please select a chain first.');
    }
});

bot.action('peer_nodes', async (ctx) => {
    const userId = ctx.from.id;
    const userAction = userLastAction[userId];
    if (userAction && userAction.chain) {
        const peer_nodes = await chainPeerNodes(ctx, userAction.chain);

        try {
            // Delete the menu message to reduce clutter
            try {
                await ctx.deleteMessage();
            } catch (error) {
                console.error('Error deleting menu message:', error);
            }
            // Send a new message with the peer nodes and follow-up keyboard
            await ctx.reply(peer_nodes, { 
                parse_mode: 'Markdown',
                disable_web_page_preview: true,
                reply_markup: createFollowUpKeyboard().reply_markup
            });
        } catch (error) {
            console.error('Error sending peer nodes:', error);
            await ctx.reply('An error occurred while sending the peer nodes. Please try again.');
        }
    } else {
        await ctx.reply('No chain selected. Please select a chain first.');
    }
});

bot.action('block_explorers', async (ctx) => {
    const userId = ctx.from.id;
    const userAction = userLastAction[userId];
    if (userAction && userAction.chain) {
        const block_explorers = await chainBlockExplorers(ctx, userAction.chain);

        try {
            // Delete the menu message to reduce clutter
            try {
                await ctx.deleteMessage();
            } catch (error) {
                console.error('Error deleting menu message:', error);
            }
            // Send a new message with the block explorers and follow-up keyboard
            await ctx.reply(block_explorers, { 
                parse_mode: 'Markdown', 
                disable_web_page_preview: true,
                reply_markup: createFollowUpKeyboard().reply_markup
            });
        } catch (error) {
            console.error('Error sending block explorers:', error);
            await ctx.reply('An error occurred while processing your request. Please try again.');
        }
    } else {
        await ctx.reply('No chain selected. Please select a chain first.');
    }
});


bot.action('switch_to_mainnet', async (ctx) => {
    const userId = ctx.from.id;
    const chains = await getChainList();
    updateUserLastAction(userId, { browsingTestnets: false });
    const keyboard = paginateChains(chains, 0, userId, pageSize);
    
    await ctx.editMessageText('Mainnet chains:', {
        parse_mode: 'Markdown',
        disable_web_page_preview: true,
        reply_markup: keyboard.reply_markup,
        chat_id: ctx.callbackQuery.message.chat.id,
        message_id: ctx.callbackQuery.message.message_id
    });
});

bot.action('switch_to_testnet', async (ctx) => {
    const userId = ctx.from.id;
    const testnetsList = await getTestnetsList();
    updateUserLastAction(userId, { browsingTestnets: true });
    const keyboard = paginateChains(testnetsList, 0, userId, pageSize);
    
    await ctx.editMessageText('Testnet chains:', {
        parse_mode: 'Markdown',
        disable_web_page_preview: true,
        reply_markup: keyboard.reply_markup,
        chat_id: ctx.callbackQuery.message.chat.id,
        message_id: ctx.callbackQuery.message.message_id
    });
});

bot.action('back_to_networks', async (ctx) => {
    const userId = ctx.from.id;
    const userAction = userLastAction[userId] || {};
    
    let chains;
    let message;
    if (userAction.browsingTestnets) {
        chains = await getTestnetsList();
        message = 'Testnet chains:';
    } else {
        chains = await getChainList();
        message = 'Select a chain:';
    }
    
    const keyboard = paginateChains(chains, 0, userId, pageSize);
    
    await ctx.editMessageText(message, {
        parse_mode: 'Markdown',
        disable_web_page_preview: true,
        reply_markup: keyboard.reply_markup,
        chat_id: ctx.callbackQuery.message.chat.id,
        message_id: ctx.callbackQuery.message.message_id
    });
});

bot.action('back_to_actions', async (ctx) => {
    const userId = ctx.from.id;
    const userAction = userLastAction[userId];
    
    if (userAction && userAction.chain) {
        const keyboardMarkup = sendMainMenu(ctx, userId);
        await ctx.editMessageText(`Selected chain: ${userAction.chain}\nSelect an action:`, {
            parse_mode: 'Markdown',
            disable_web_page_preview: true,
            reply_markup: keyboardMarkup.reply_markup,
            chat_id: ctx.callbackQuery.message.chat.id,
            message_id: ctx.callbackQuery.message.message_id
        });
    } else {
        await ctx.reply('No chain selected. Please select a chain first.');
    }
});

// Clear stored message details if needed
function cleanupLastFunctionMessage() {
    const now = new Date();
    Object.keys(userLastAction).forEach(userId => {
        if (userLastAction[userId] &&
            (now - new Date(userLastAction[userId].timestamp)) > UPDATE_INTERVAL) {
            userLastAction[userId] = null;
        }
    });
}

setInterval(periodicUpdateRepo, UPDATE_INTERVAL);
periodicUpdateRepo();

// Start the bot
bot.launch()
  .then(() => console.log('Bot launched successfully'))
  .catch(error => console.error('Failed to launch the bot:', error));

// Enable graceful stop
process.once('SIGINT', () => {
  console.log('SIGINT signal received. Shutting down gracefully.');
  bot.stop('SIGINT received');
  process.exit(0);
});

process.once('SIGTERM', () => {
  console.log('SIGTERM signal received. Shutting down gracefully.');
  bot.stop('SIGTERM received');
  process.exit(0);
});
