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

    // Retrieve the chain list and generate paginated chain list
    const chains = await getChainList();
    const keyboard = paginateChains(chains, 0, userId, pageSize);
    ctx.reply('Select a chain:', keyboard);
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
        .map(dirent => `testnets/${dirent.name}`);

    return directories.sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
}

const unhealthyEndpoints = new Set(); // Keep track of endpoints that are down

// Helper function to perform a simple DNS lookup to check if the host is reachable.
function isHostReachable(hostname) {
  return new Promise((resolve) => {
    dns.lookup(hostname, (err) => {
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

async function chainInfo(ctx, chain) {
    try {
        const userId = ctx.from.id;
        const userAction = userLastAction[userId];
        const directory = userAction.browsingTestnets ? path.join(REPO_DIR, 'testnets', chain) : path.join(REPO_DIR, chain);

        const assetListPath = path.join(directory, 'assetlist.json');
        const chainJsonPath = path.join(directory, 'chain.json');

        const assetData = JSON.parse(fs.readFileSync(assetListPath, 'utf8'));
        const chainData = JSON.parse(fs.readFileSync(chainJsonPath, 'utf8'));

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

        const rpcAddress = await findHealthyEndpoint(chainData.apis.rpc, true); // For RPC
        const restAddress = await findHealthyEndpoint(chainData.apis.rest, false); // For REST

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
        // Determine the correct directory path based on whether we're looking at testnets or mainnets
        const directory = userAction.browsingTestnets ? path.join(REPO_DIR, 'testnets', chain) : path.join(REPO_DIR, chain);

        const chainJsonPath = path.join(directory, 'chain.json');
        const chainData = JSON.parse(fs.readFileSync(chainJsonPath, 'utf8'));


        const formatService = (service) => {
            // Bold format for provider and escape underscores
            const provider = `*${service.provider.replace(/[^\w\s.-]/g, '').replace(/\./g, '_')}*`;
            // Enclose address in backticks and escape underscores
            const address = `\`${service.address.replace(/\/$/, '').replace(/_/g, '\\_')}\``;
            return `${provider}:\n${address}\n`;
        };

        const formatEndpoints = (services, title, maxEndpoints) => {
            if (!services || services.length === 0) {
                return `*${title}*\nNo data available\n`;
            }
            const formattedServices = services.slice(0, maxEndpoints).map(formatService).join("\n");
            return `*${title}*\n${'-'.repeat(title.length)}\n${formattedServices}\n`;
        };

        const maxEndpointsPerService = 5;
        let responseSections = [];
        responseSections.push(formatEndpoints(chainData.apis.rpc, "RPC", maxEndpointsPerService));
        responseSections.push(formatEndpoints(chainData.apis.rest, "REST", maxEndpointsPerService));
        responseSections.push(formatEndpoints(chainData.apis.grpc, "GRPC", maxEndpointsPerService));

        if (chainData.apis['evm-http-jsonrpc']) {
            responseSections.push(formatEndpoints(chainData.apis['evm-http-jsonrpc'], "EVM-HTTP-JSONRPC", maxEndpointsPerService));
        }

        // Combine all sections into one response
        const response = responseSections.join("\n\n").trim();

        // Log the complete response and the length for debugging
        console.log('Final formatted response:', response);
        console.log('Response length:', response.length);

        // Send the response in parts if it's too long
        if (response.length > 4096) {
            console.log('Response is too long, sending in parts.');
            const parts = splitIntoParts(response, 4000); // Helper function needed to split the message
            for (const part of parts) {
                await ctx.replyWithMarkdown(part);
            }
        } else {
            await ctx.replyWithMarkdown(response);
        }
    } catch (error) {
        console.error(`[${new Date().toISOString()}] Error fetching endpoints for ${chain}: ${error.message}`);
        await ctx.reply(`Error fetching endpoints for ${chain}. Please try again.`);
    }
}

// Helper function to split a long message into parts
function splitIntoParts(str, maxLength) {
    const parts = [];
    let currentPart = '';
    str.split('\n').forEach(line => {
        if ((currentPart + line).length <= maxLength) {
            currentPart += line + '\n';
        } else {
            parts.push(currentPart);
            currentPart = line + '\n';
        }
    });
    if (currentPart) {
        parts.push(currentPart);
    }
    return parts;
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

async function handlePoolIncentives(ctx, poolId) {
    const url = `http://jasbanza.dedicated.co.za:7000/pool/${poolId}`;
    http.get(url, (res) => {
        let rawData = '';

        res.on('data', (chunk) => {
            rawData += chunk;
        });

        res.on('end', () => {
            try {
                // Extract JSON string from the HTML response
                const jsonMatch = rawData.match(/<pre>([\s\S]*?)<\/pre>/);
                if (!jsonMatch || jsonMatch.length < 2) {
                    throw new Error("No valid JSON found in the server's response.");
                }
                const jsonString = jsonMatch[1];
                const data = JSON.parse(jsonString);
                const formattedResponse = formatPoolIncentivesResponse(data);
                ctx.reply(formattedResponse);
            } catch (error) {
                console.error('Error processing pool incentives data:', error);
                ctx.reply('Error processing pool incentives data. Please try again.');
            }
        });
    }).on('error', (error) => {
        console.error('Error fetching pool incentives data:', error);
        ctx.reply('Error fetching pool incentives data. Please try again.');
    });
}

function formatPoolIncentivesResponse(data) {
    // Check if the initial data is empty
    if (!data.data || data.data.length === 0) {
        return 'No incentives data available.';
    }

    let response = '';
    const currentDate = new Date(); // Get the current date

    // Filter out expired incentives and sort by start time
    const filteredAndSortedData = data.data
        .filter(incentive => {
            const startTime = new Date(incentive.start_time);
            const durationDays = parseInt(incentive.num_epochs_paid_over);
            const endTime = new Date(startTime);
            endTime.setDate(startTime.getDate() + durationDays); // Calculate end time

            return startTime.getFullYear() !== 1970 && durationDays !== 1 && endTime > currentDate;
        })
        .sort((a, b) => new Date(b.start_time) - new Date(a.start_time));

    // Check if the filtered data is empty
    if (filteredAndSortedData.length === 0) {
        return 'No current incentives available.';
    }

    // Format the response
    filteredAndSortedData.forEach((incentive) => {
        const startTime = new Date(incentive.start_time);
        const numEpochs = parseInt(incentive.num_epochs_paid_over);

        response += `Start Time: ${startTime.toLocaleDateString()}\n`;
        response += `Duration: ${numEpochs} days\n`;
        response += `Coin: ${incentive.coins.map(coin => `${coin.denom}, Amount: ${coin.amount}`).join('\n')}\n\n`;
    });

    return response;
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
                    });
                } else {
                    console.error('Unexpected result from chainInfo:', chainInfoResult);
                    await ctx.reply('Failed to fetch chain info.');
                }
                break;
            case 'peer_nodes':
                const peerNodesMessage = await chainPeerNodes(ctx, userAction.chain);
                await ctx.reply(peerNodesMessage, { parse_mode: 'Markdown' });
                break;
            case 'endpoints':
                const chainEndpointsMessage = await chainEndpoints(ctx, userAction.chain);

                // Check if the chainEndpointsMessage is not null or empty
                if (chainEndpointsMessage && chainEndpointsMessage.trim() !== '') {
                    // Check if the message length exceeds the Telegram limit
                    if (chainEndpointsMessage.length > 4096) {
                        const parts = splitIntoParts(chainEndpointsMessage, 4000);
                        for (const part of parts) {
                            await ctx.replyWithMarkdown(part);
                        }
                    } else {
                        await ctx.replyWithMarkdown(chainEndpointsMessage);
                    }
                } else {
                    console.error('Error: Endpoints data is unexpectedly empty.');
                    await ctx.reply('Error fetching endpoints data. Please try again.');
                }
                break;
            case 'block_explorers':
                const blockExplorersMessage = await chainBlockExplorers(ctx, userAction.chain);
                await ctx.replyWithMarkdown(blockExplorersMessage);
                break;
            case 'ibc_id':
                await ctx.reply(`Enter IBC denom for ${userAction.chain}:`, { parse_mode: 'Markdown' });
                break;
            case 'pool_incentives':
                if (userAction.chain === 'osmosis') {
                    await ctx.reply('Enter pool_id for osmosis (AMM pool-type only):');
                    expectedAction[userId] = 'awaiting_pool_id';
                } else {
                    await ctx.reply('Pool incentives are only available for Osmosis.');
                }
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

// Utility function to escape Markdown special characters
function sendMainMenu(ctx, userId) {
    const userAction = userLastAction[userId];
    const mainMenuButtons = [
        Markup.button.callback('1. Chain Info', 'chain_info'),
        Markup.button.callback('2. Peer Nodes', 'peer_nodes'),
        Markup.button.callback('3. Endpoints', 'endpoints'),
        Markup.button.callback('4. Block Explorers', 'block_explorers')
    ];

    // Add IBC-ID and Pool Incentives buttons only for mainnet chains
    if (!userAction.browsingTestnets) {
        mainMenuButtons.push(Markup.button.callback('5. IBC-ID', 'ibc_id'));
        if (userAction.chain === 'osmosis') {
            mainMenuButtons.push(Markup.button.callback('6. Pool Incentives [non-sc]', 'pool_incentives'));
        }
    }

    return Markup.inlineKeyboard(mainMenuButtons, { columns: 2 });
}

function paginateChains(chains, currentPage, userId, pageSize) {
    console.log(`Paginating chains. Total chains: ${chains.length}, Current page: ${currentPage}, Page size: ${pageSize}`);

    const totalPages = Math.ceil(chains.length / pageSize);
    const start = currentPage * pageSize;
    const end = start + pageSize;
    const chainsToShow = chains.slice(start, end);
    const lastSelectedChain = userLastAction[userId]?.chain;

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

    if (chain === 'testnets') {
        // Assuming you have a separate directory for testnets
        const testnetsDir = path.join(REPO_DIR, 'testnets');
        const testnetsList = await getChainList(testnetsDir);

        // Store the fact that the user is looking at testnets and the list of testnets
        updateUserLastAction(userId, {
            browsingTestnets: true,
            testnetsList: testnetsList,
            messageId: ctx.callbackQuery.message.message_id,
            chatId: ctx.callbackQuery.message.chat.id
        });

        // Show the list of testnets using the pagination function
        const keyboardMarkup = paginateChains(testnetsList, 0, userId, 18); // Adjust page size as needed
        await ctx.reply('Select a testnet:', keyboardMarkup);
    } else {
        // If the user is not browsing testnets, store the selected chain
        updateUserLastAction(userId, {
            chain: chain,
            messageId: ctx.callbackQuery.message.message_id,
            chatId: ctx.callbackQuery.message.chat.id,
            browsingTestnets: false
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
    }
});

bot.action('ibc_id', async (ctx) => {
    const userId = ctx.from.id;
    const userAction = userLastAction[userId];
    if (userAction && userAction.chain) {
        await ctx.reply(`Enter IBC denom for ${userAction.chain}:`);
    } else {
        await ctx.reply('No chain selected. Please select a chain first.');
    }
});

bot.action('pool_incentives', async (ctx) => {
    const userId = ctx.from.id;
    const userAction = userLastAction[userId];
    if (userAction && userAction.chain) {
        await ctx.reply(`Enter pool_id for ${userAction.chain} (AMM pool-type only):`);
        expectedAction[userId] = 'awaiting_pool_id';
    } else {
        await ctx.reply('No chain selected. Please select a chain first.');
    }
});

bot.on('text', async (ctx) => {
    const text = ctx.message.text.trim();
    const userId = ctx.from.id;
    const userAction = userLastAction[userId];

    console.log(`Received text: ${text} from user: ${userId}`);

    if (expectedAction[userId] === 'awaiting_pool_id') {
        // Process pool_id input
        const poolId = parseInt(text, 10);
        if (isNaN(poolId)) {
            await ctx.reply('Please enter a valid pool_id.');
        } else {
            await handlePoolIncentives(ctx, poolId);
            delete expectedAction[userId]; // Clear the expected action after handling
        }
    } else if (text === '/start') {
        // Reset/establish user session
        if (!userLastAction[userId]) {
            userLastAction[userId] = {};
        } else {
            console.log(`Session already exists for user ${userId}`);
        }
    } else if (!isNaN(text)) {
        // Numeric input for menu selection
        const optionIndex = parseInt(text) - 1;
        const mainMenuOptions = ['chain_info', 'peer_nodes', 'endpoints', 'block_explorers', 'ibc_id', 'pool_incentives'];
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
        const ibcHash = text.replace('ibc/', '');
        console.log(`Processing IBC request for hash: ${ibcHash}, chain: ${userAction?.chain}`);
        if (userAction && userAction.chain) {
            // Retrieve chain info as object
            try {
                const chainInfoResult = await chainInfo(ctx, userAction.chain);
                console.log(`chainInfoResult: `, chainInfoResult.message);
                if (chainInfoResult && chainInfoResult.data && chainInfoResult.data.restAddress) {
                    let restAddress = chainInfoResult.data.restAddress.replace(/\/+$/, ''); // Remove trailing slashes
                    const url = `${restAddress}/ibc/apps/transfer/v1/denom_traces/${ibcHash}`;
                    console.log(`Requesting URL: ${url}`);
                    https.get(url, (res) => {
                        let data = '';
                        res.on('data', (chunk) => {
                            data += chunk;
                        });
                        res.on('end', () => {
                            try {
                                const response = JSON.parse(data);
                                ctx.reply(`IBC Denom Trace: \n${JSON.stringify(response.denom_trace, null, 2)}`);
                            } catch (parseError) {
                                console.error('Error parsing response:', parseError);
                                ctx.reply('Error fetching IBC denom trace. Please try again.');
                            }
                        });
                    }).on('error', (error) => {
                        console.error('Error fetching IBC denom trace:', error);
                        ctx.reply('Error fetching IBC denom trace. Please try again.');
                    });
                } else {
                    ctx.reply('Error: REST address not found for the selected chain.');
                    console.log('REST address not found in chainInfoResult');
                }
            } catch (error) {
                console.error('Error processing chainInfo:', error);
                ctx.reply('Error processing request. Please try again.');
            }
        } else {
            ctx.reply('No chain selected. Please select a chain first.');
            console.log('No chain selected for user action');
        }
    } else {
        const chains = await getChainList();
        if (chains.includes(text)) {
            // Select chain as if user clicked the button
            updateUserLastAction(userId, { chain: text });
            const keyboardMarkup = sendMainMenu(ctx, userId);
            await ctx.reply('Select an action:', keyboardMarkup);
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

        const chains = await getChainList();
        console.log(`Total chains retrieved: ${chains.length}`);

        // Get userId to pass to paginateChains
        const userId = ctx.from.id;

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
        try {
    const chainInfoResult = await chainInfo(ctx, userAction.chain);
    if (chainInfoResult && chainInfoResult.message) {
        await ctx.reply(chainInfoResult.message, {
            parse_mode: 'Markdown',
            disable_web_page_preview: true,
    });
            } else {
                // If the result is not in expected format, log the error and reply with a message
                console.error(`chainInfo did not return expected data:`, chainInfoResult);
                await ctx.reply('An error occurred while fetching the chain information.');
            }
        } catch (error) {
            console.error('Error fetching chain info:', error);
            await ctx.reply(`An error occurred while processing your request: ${error.message}`);
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

        //    if (!endpoints || typeof endpoints !== 'string' || !endpoints.trim()) {
          //      console.error(`Endpoints data is unexpectedly empty for chain ${userAction.chain}.`);
         //       await ctx.reply('Error: Received unexpectedly empty data.');
          //      return;


           // console.log('Formatted Endpoints:', endpoints);
        try {
            if (userAction.messageId) {
                await ctx.telegram.editMessageText(
                    userAction.chatId,
                    userAction.messageId,
                    null,
                    endpoints,
                    { parse_mode: 'Markdown',
                        disable_web_page_preview: true,
                    }
                );
            } else {
                const sentMessage = await ctx.reply(endpoints, { parse_mode: 'Markdown'});
                updateUserLastAction(userId, {
                    messageId: sentMessage.message_id,
                    chatId: sentMessage.chat.id
                });
            }
        } catch (error) {
            console.error('Error editing message:', error);
            // Handle error by sending new message
        }
    } else {
        ctx.reply('No chain selected. Please select a chain first.');
    }
});

bot.action('peer_nodes', async (ctx) => {
    const userId = ctx.from.id;
    const userAction = userLastAction[userId];
    if (userAction && userAction.chain) {
        const peer_nodes = await chainPeerNodes(ctx, userAction.chain);

        try {
            if (userAction.messageId) {
                await ctx.telegram.editMessageText(
                    userAction.chatId,
                    userAction.messageId,
                    null,
                    peer_nodes,
                    { parse_mode: 'Markdown',
                        disable_web_page_preview: true,
                    }
                );
            } else {
                const sentMessage = await ctx.reply(peer_nodes, { parse_mode: 'Markdown' });
                updateUserLastAction(userId, {
                    messageId: sentMessage.message_id,
                    chatId: sentMessage.chat.id
                });
            }
        } catch (error) {
            console.error('Error editing message:', error);
            // Handle error by sending new message
        }
    } else {
        ctx.reply('No chain selected. Please select a chain first.');
    }
});

bot.action('block_explorers', async (ctx) => {
    const userId = ctx.from.id;
    const userAction = userLastAction[userId];
    if (userAction && userAction.chain) {
        const block_explorers = await chainBlockExplorers(ctx, userAction.chain);

        try {
            if (userAction.messageId) {
                await ctx.telegram.editMessageText(
                    userAction.chatId,
                    userAction.messageId,
                    null,
                    block_explorers,
                    { parse_mode: 'Markdown', disable_web_page_preview: true }
                );
            } else {
                const sentMessage = await ctx.reply(block_explorers, { parse_mode: 'Markdown', disable_web_page_preview: true });
                updateUserLastAction(userId, {
                    messageId: sentMessage.message_id,
                    chatId: sentMessage.chat.id
                });
            }
        } catch (error) {
            console.error('Error editing message:', error);
            await ctx.reply('An error occurred while processing your request. Please try again.');
        }
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
    bot.stop('SIGINT');
    console.log('Bot stopped with SIGINT');
});

process.once('SIGTERM', () => {
    bot.stop('SIGTERM');
    console.log('Bot stopped with SIGTERM');
});

process.on('SIGTERM', () => {
console.log('SIGTERM signal received. Shutting down gracefully.');
    bot.stop('SIGTERM received'); // Replace 'bot' with your bot instance variable
    process.exit(0);
});
