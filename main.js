const {
        Telegraf,
        Markup
} = require("telegraf");
const fs = require("fs");
const path = require("path");
const exec = require("child_process").exec;
const https = require('https');
const http = require('http');

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
                        console.log(`Cloning repository: ${REPO_URL}`);
                        await execPromise(`git clone ${REPO_URL} ${REPO_DIR}`);
                        console.log('Repository cloned successfully.');
                } else {
                        const stats = fs.statSync(REPO_DIR);
                        const hoursDiff = (new Date() - new Date(stats.mtime)) / 3600000;
                        if (hoursDiff > STALE_HOURS) {
                                console.log(`Updating repository in ${REPO_DIR}`);
                                await execPromise(`git -C ${REPO_DIR} pull`);
                                console.log('Repository updated successfully.');
                        }
                }
        } catch (error) {
                console.log('Error in cloning or updating the repository:', error);
                console.warn('Warning: Using old data due to update failure.');
                // Use old data if the repository update fails
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
    // Clear any existing session data
    resetUserSession(userId);

    // Retrieve the chain list and generate paginated chain list
    const chains = await getChainList();
    const keyboard = paginateChains(chains, 0, userId, pageSize);
    ctx.reply('Select a chain:', keyboard);
}

bot.start(async (ctx) => {
    await startInteraction(ctx);
});

bot.command('reset', async (ctx) => {
    await startInteraction(ctx);
});

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

// Reset the user session
function resetUserSession(userId) {
    updateUserLastAction(userId, null);
}

function cleanupUserSessions() {
        const now = new Date();
        Object.keys(userLastAction).forEach(userId => {
                if ((now - new Date(userLastAction[userId].timestamp)) > 300000) {
                        delete userLastAction[userId];
                }
        });
}

setInterval(cleanupUserSessions, 60000);

async function getChainList() {
    const directories = fs.readdirSync(REPO_DIR, {
            withFileTypes: true
        })
        .filter(dirent => dirent.isDirectory() && /^[A-Za-z0-9]/.test(dirent.name))
        .map(dirent => dirent.name);

    // Non-case-sensitive sorting
    return directories.sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
}

async function chainInfo(chain) {
    try {
        const assetListPath = path.join(REPO_DIR, `${chain}/assetlist.json`);
        const chainJsonPath = path.join(REPO_DIR, `${chain}/chain.json`);

        const assetData = JSON.parse(fs.readFileSync(assetListPath, 'utf8'));
        const chainData = JSON.parse(fs.readFileSync(chainJsonPath, 'utf8'));

        const baseDenom = chainData.staking?.staking_tokens[0]?.denom || "Unknown";

        const nativeDenomExponent = assetData.assets[0]?.denom_units.slice(-1)[0];
        const decimals = nativeDenomExponent ? nativeDenomExponent.exponent : "Unknown";

        const rpcAddress = chainData.apis?.rpc?.find(api => api.address)?.address || "Unknown";
        const restAddress = chainData.apis?.rest?.find(api => api.address)?.address || "Unknown";
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

            // Return the preferred explorer
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
        console.log(`Error fetching data for ${chain}:`, error.stack);
        return `Error fetching data for ${chain}: ${error.message}. Please contact developer or open an issue on Github.`;
    }
}

async function chainEndpoints(chain) {
    try {
        const chainJsonPath = path.join(REPO_DIR, `${chain}/chain.json`);
        const chainData = JSON.parse(fs.readFileSync(chainJsonPath, 'utf8'));

const formatEndpoints = (services, title, maxEndpoints) => {
    if (!services || services.length === 0) return '';
    const limitedServices = services.slice(0, maxEndpoints);
    return `${title}\n-----------\n${limitedServices.map(service => {
        // Replace non-alphanumeric and non-punctuation characters with an empty string
        const provider = service.provider.replace(/[^\w\s.-]/g, '');
        // Replace periods with underscores
        const sanitizedProvider = provider.replace(/\./g, '_');
        // Format the address with backticks
        const address = `\`${service.address}\``;
        return `  ${sanitizedProvider}: ${address}`;
    }).join("\n")}\n\n`;
};

        const maxEndpointsPerService = 5;
        const rpcEndpoints = formatEndpoints(chainData.apis.rpc, "RPC", maxEndpointsPerService);
        const restEndpoints = formatEndpoints(chainData.apis.rest, "API", maxEndpointsPerService);
        const grpcEndpoints = formatEndpoints(chainData.apis.grpc, "GRPC", maxEndpointsPerService);
        const evmHttpJsonRpcEndpoints = formatEndpoints(chainData.apis['evm-http-jsonrpc'], "EVM-HTTP-JSONRPC", maxEndpointsPerService);

        return `${rpcEndpoints}${restEndpoints}${grpcEndpoints}${evmHttpJsonRpcEndpoints}`;
    } catch (error) {
        console.log(`Error fetching endpoints for ${chain}:`, error.message);
        return `Error fetching endpoints for ${chain}. Please ensure the chain name is correct and try again.`;
    }
}

async function chainPeerNodes(chain) {
    try {
        const chainJsonPath = path.join(REPO_DIR, `${chain}/chain.json`);
        const chainData = JSON.parse(fs.readFileSync(chainJsonPath, 'utf8'));

        const sanitizeProvider = (provider) => {
            if (!provider) return 'unnamed';
            // Remove special characters and replace periods with underscores
            return provider.replace(/[^\w\s.-]/g, '').replace(/\./g, '_');
        };

        const formatPeers = (peers, title) => {
            if (!peers || peers.length === 0) return `*${title}*\n---------------------\nNo data available\n\n`;
            const formattedPeers = peers.map(peer => {
                const provider = `*${sanitizeProvider(peer.provider)}*`;
                const id = peer.id ? `id: \`${peer.id}\`` : 'id: unavailable';
                const address = peer.address ? `URL: \`${peer.address}\`` : 'URL: unavailable';
                return `\n${provider}:\n---------------------\n ${id}\n ${address}`;
            }).join("\n");
            return `*${title}*\n---------------------\n${formattedPeers}\n\n`;
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

async function chainBlockExplorers(chain) {
    try {
        const chainJsonPath = path.join(REPO_DIR, `${chain}/chain.json`);
        const chainData = JSON.parse(fs.readFileSync(chainJsonPath, 'utf8'));

        const explorersList = chainData.explorers
            .map(explorer => `*${explorer.kind.replace(/\./g, '_')}*\n____________________\n${explorer.url}\n`)
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
    let response = '';
    
    // Filter out entries from 1970 and sort by start time
    const filteredAndSortedData = data.data
        .filter(incentive => {
            const startTime = new Date(incentive.start_time);
            return startTime.getFullYear() !== 1970;
        })
        .sort((a, b) => new Date(b.start_time) - new Date(a.start_time));
    
    // Format the response
    filteredAndSortedData.forEach((incentive) => {
        const startTime = new Date(incentive.start_time);
        const numEpochs = parseInt(incentive.num_epochs_paid_over);
        const filledEpochs = parseInt(incentive.filled_epochs);

        response += `Start Time: ${startTime.toLocaleDateString()}\n`;
        response += `Duration: ${numEpochs} days\n`;
        response += `Elapsed: ${filledEpochs} days\n`;

        if (incentive.coins) {
            incentive.coins.forEach((coin) => {
                response += `Coin: ${coin.denom}, Amount: ${coin.amount}\n`;
            });
        }

        response += '\n';
    });

    return response;
}

function sendMainMenu(ctx, userId) {
    // Start with the basic buttons that are always included
    const mainMenuButtons = [
        Markup.button.callback('Chain Info', 'chain_info'),
        Markup.button.callback('Peer Nodes', 'peer_nodes'),
        Markup.button.callback('Endpoints', 'endpoints'),
        Markup.button.callback('Block Explorers', 'block_explorers'),
        Markup.button.callback('IBC-ID', 'ibc_id')
    ];

    // Retrieve the last action for the user
    const lastAction = userLastAction[userId];

    // Conditionally add the 'Pool Incentives [non-sc]' button if the chain is 'Osmosis'
    if (lastAction.chain === 'osmosis') {
        mainMenuButtons.push(Markup.button.callback('Pool Incentives [non-sc]', 'pool_incentives'));
    }

    // Return the keyboard markup
    return Markup.inlineKeyboard(mainMenuButtons, {
        columns: 2
    });
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

process.on('SIGTERM', () => {
    console.log('SIGTERM signal received. Shutting down gracefully.');
    bot.stop('SIGTERM received'); // Replace 'bot' with your bot instance variable
    process.exit(0);
});

bot.action(/^select_chain:(.+)$/, async (ctx) => {
    const chain = ctx.match[1];
    const userId = ctx.from.id;

    // Update the user's last action
    updateUserLastAction(userId, {
        chain: chain,
        // Store messageId & chatId for future reference
        messageId: ctx.callbackQuery.message.message_id,
        chatId: ctx.callbackQuery.message.chat.id
    });

    // Attempt to show the main menu for the selected chain
    try {
        const keyboardMarkup = sendMainMenu(ctx, userId);
        await ctx.editMessageText('Select an action:', {
            parse_mode: 'Markdown',
            disable_web_page_preview: true,
            reply_markup: keyboardMarkup.reply_markup,
            chat_id: ctx.callbackQuery.message.chat.id,
            message_id: ctx.callbackQuery.message.message_id
        });
    } catch (error) {
        console.error('Error while trying to show main menu:', error);
        // If the original message is not found, send a new message with the menu
        if (error.description === 'Bad Request: message to edit not found') {
            const keyboardMarkup = sendMainMenu(ctx, userId);
            const sentMessage = await ctx.reply('Select an action:', keyboardMarkup);
            // Update the last action with the new message details
            updateUserLastAction(userId, {
                messageId: sentMessage.message_id,
                chatId: sentMessage.chat.id
            });
        }
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

    // Check if expecting pool_id from user.
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
        const chains = await getChainList();
        const keyboard = paginateChains(chains, 0, userId, pageSize);
        await ctx.reply('Select a chain:', keyboard);
    } else if (text.startsWith('ibc/')) {
        const ibcHash = text.replace('ibc/', '');
        const userAction = userLastAction[userId];
        console.log(`Processing IBC request for hash: ${ibcHash}, chain: ${userAction?.chain}`);

        if (userAction && userAction.chain) {
            // Retrieve chain info as object
            try {
                const chainInfoResult = await chainInfo(userAction.chain);
                console.log(`chainInfoResult: `, chainInfoResult);

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
    } else if (text.startsWith('pool/')) {
        const poolId = text.replace('pool/', '');
        await handlePoolIncentives(ctx, poolId);
    } else {
        console.log(`Received text: ${text}`);
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
        // Fetch new chain info
        const chainInfoResult = await chainInfo(userAction.chain);

        // Check if message content same after edit
        if (chainInfoResult.message === ctx.callbackQuery.message.text) {
            // If content same, don't edit message
            return ctx.answerCbQuery('The chain information is already up to date.');
        }

        // Proceed with editing message if content changed
        try {
            await ctx.editMessageText(chainInfoResult.message, {
                parse_mode: 'Markdown',
                disable_web_page_preview: true,
            });
        } catch (error) {
            console.error('Error editing message:', error);

            if (error.description.includes('message is not modified')) {
                // Ignore or handle the redundant edit attempt
            } else {
                    
            }
        }
    } else {
        ctx.reply('No chain selected. Please select a chain first.');
    }
});

bot.action('endpoints', async (ctx) => {
    const userId = ctx.from.id;
    const userAction = userLastAction[userId];
    if (userAction && userAction.chain) {
        const endpoints = await chainEndpoints(userAction.chain);
        const formattedEndpoints = endpoints.replace(/_/g, '\\_'); // Escape underscores for Markdown

        try {
            if (userAction.messageId) {
                await ctx.telegram.editMessageText(
                    userAction.chatId,
                    userAction.messageId,
                    null,
                    formattedEndpoints,
                    { parse_mode: 'Markdown',
                        disable_web_page_preview: true,
                    }
                );
            } else {
                const sentMessage = await ctx.replyWithMarkdown(formattedEndpoints);
                updateUserLastAction(userId, {
                    messageId: sentMessage.message_id,
                    chatId: sentMessage.chat.id
                });
            }
        } catch (error) {
            console.error('Error editing message:', error);
            // Handle error, e.g., by sending new message
        }
    } else {
        ctx.reply('No chain selected. Please select a chain first.');
    }
});

bot.action('peer_nodes', async (ctx) => {
    const userId = ctx.from.id;
    const userAction = userLastAction[userId];
    if (userAction && userAction.chain) {
        const peer_nodes = await chainPeerNodes(userAction.chain);

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
        const block_explorers = await chainBlockExplorers(userAction.chain);

        try {
            if (userAction.messageId) {
                await ctx.telegram.editMessageText(
                    userAction.chatId,
                    userAction.messageId,
                    null,
                    block_explorers,
                    { parse_mode: 'Markdown',
                        disable_web_page_preview: true, }
                );
            } else {
                const sentMessage = await ctx.reply(block_explorers, { disable_web_page_preview: true });
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

bot.launch().then(() => {
    console.log('Bot launched successfully');
}).catch(error => {
    console.error('Failed to launch the bot:', error);
});

// Enable graceful stop
process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
