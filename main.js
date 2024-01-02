const {
        Telegraf,
        Markup
} = require("telegraf");
const fs = require("fs");
const path = require("path");
const exec = require("child_process").exec;

const pageSize = 18;

const BOT_TOKEN = process.env.BOT_TOKEN;

const bot = new Telegraf(BOT_TOKEN);

const REPO_URL = "https://github.com/Cordtus/chain-registry1.git";
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

// Promisify the exec function to use with async/await
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

function updateUserLastAction(userId, data) {
        userLastAction[userId] = {
                ...data,
                timestamp: new Date()
        };
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

        // Fetching 'Base Denom' from the specified path in 'chain.json'
        const baseDenom = chainData.staking?.staking_tokens[0]?.denom || "Unknown";

        const nativeDenomExponent = assetData.assets[0]?.denom_units.slice(-1)[0];
        const decimals = nativeDenomExponent ? nativeDenomExponent.exponent : "Unknown";

        const rpcAddress = chainData.apis?.rpc?.find(api => api.address)?.address || "Unknown";
        const restAddress = chainData.apis?.rest?.find(api => api.address)?.address || "Unknown";
        const grpcAddress = chainData.apis?.grpc?.find(api => api.address)?.address || "Unknown";

        return `Chain ID: \`${chainData.chain_id}\`\n` +
               `Chain Name: \`${chainData.chain_name}\`\n` +
               `RPC: \`${rpcAddress}\`\n` +
               `REST: \`${restAddress}\`\n` +
               `GRPC: \`${grpcAddress}\`\n` +
               `Address Prefix: \`${chainData.bech32_prefix}\`\n` +
               `Base Denom: \`${baseDenom}\`\n` +
               `Cointype: \`${chainData.slip44}\`\n` +
               `Decimals: \`${decimals}\``;
    } catch (error) {
        console.log(`Error fetching data for ${chain}:`, error.stack);
        return `Error fetching data for ${chain}. Please contact developer or open an issue on Github.`;
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
            .map(explorer => `[${explorer.kind}](${explorer.url})`)
            .join('\n');
        return explorersList;
    } catch (error) {
        console.log(`Error fetching block explorers for ${chain}:`, error.message);
        return `Error fetching block explorers for ${chain}. Please contact developer or open an issue on Github.`;
    }
}

function sendMainMenu(ctx) {
        const mainMenuButtons = [
                Markup.button.callback('Chain Info', 'chain_info'),
                Markup.button.callback('Peer Nodes', 'peer_nodes'),
                Markup.button.callback('Endpoints', 'endpoints'),
                Markup.button.callback('Block Explorers', 'block_explorers')
        ];
        return ctx.reply('Select an action:', Markup.inlineKeyboard(mainMenuButtons, {
                columns: 2
        }));
}

function paginateChains(chains, currentPage) {
    const totalPages = Math.ceil(chains.length / pageSize);
    const start = currentPage * pageSize;
    const end = start + pageSize;
    const chainsToShow = chains.slice(start, end);

    const buttons = chainsToShow.map(chain => Markup.button.callback(chain, `select_chain:${chain}`));

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

    const keyboardMarkup = Markup.inlineKeyboard(rowsOfButtons);

    // Debugging: Log the generated keyboardMarkup
    console.log(`Generated keyboardMarkup for page ${currentPage}:`, JSON.stringify(keyboardMarkup));

    // Error check for empty keyboard
    if (rowsOfButtons.length === 0) {
        console.log('No buttons generated for keyboardMarkup');
    }

    return keyboardMarkup;
}

bot.action(/^select_chain:(.+)$/, async (ctx) => {
        const chain = ctx.match[1];
        updateUserLastAction(ctx.from.id, {
                chain: chain
        });
        sendMainMenu(ctx); // This will show the action menu
});

bot.on('text', async (ctx) => {
    const text = ctx.message.text;
    const userId = ctx.from.id;

    if (text === '/start') {
        // Check if the user session already exists
        if (!userLastAction[userId]) {
            // Reset user session
            userLastAction[userId] = {};
        } else {
            // If session exists, skip cloning or updating the repo
            console.log(`Session already exists for user ${userId}`);
        }

        const chains = await getChainList();
        const keyboard = paginateChains(chains, 0);
        ctx.reply('Select a chain:', keyboard);
    } else {
        // Placeholder for handling other texts
        console.log(`Received text: ${text}`);
        // Future implementation for handling specific text inputs
    }
});

bot.action(/page:(\d+)/, async (ctx) => {
    console.log("Page action triggered", ctx);
    try {
        const page = parseInt(ctx.match[1]);
        console.log(`Page requested: ${page}`);

        const chains = await getChainList();
        console.log(`Total chains retrieved: ${chains.length}`);

        if (!chains.length) {
            console.log('No chains available');
            return ctx.reply('No chains available.');
        }

        if (page < 0 || page >= Math.ceil(chains.length / pageSize)) {
            console.log(`Invalid page number: ${page}`);
            return ctx.reply('Invalid page number.');
        }

        const keyboard = paginateChains(chains, page, pageSize); // Pass pageSize to paginateChains

        console.log(`Generated keyboardMarkup for page ${page}:`, JSON.stringify(keyboard.reply_markup));

        if (!keyboard.reply_markup || keyboard.reply_markup.inline_keyboard.length === 0) {
            console.log('Generated keyboard is empty or invalid');
            return ctx.reply('Unable to generate navigation buttons.');
        }

        // Get the message ID from the callback query
        const messageId = ctx.callbackQuery.message.message_id;
        const chatId = ctx.callbackQuery.message.chat.id;

        const result = await ctx.editMessageReplyMarkup({
            inline_keyboard: keyboard.reply_markup.inline_keyboard,
            chat_id: chatId,
            message_id: messageId
});

        console.log('Edit message response:', result);
    } catch (error) {
        console.log(`Error on page action: ${error}`);
        console.log(`Error details:`, error);
        ctx.reply('An error occurred while processing your request.');
    }
});

bot.action('chain_info', async (ctx) => {
    const userId = ctx.from.id;
    const userAction = userLastAction[userId];
    if (userAction && userAction.chain) {
        const info = await chainInfo(userAction.chain);
        ctx.replyWithMarkdown(info);
    } else {
        ctx.reply('No chain selected. Please select a chain first.');
    }
});

bot.action('endpoints', async (ctx) => {
    const userId = ctx.from.id;
    const userAction = userLastAction[userId];
    if (userAction && userAction.chain) {
        const endpoints = await chainEndpoints(userAction.chain);
        // Use Markdown formatting and escape characters that need it
        const formattedEndpoints = endpoints.replace(/_/g, '\\_'); // Escape underscores for Markdown
        ctx.replyWithMarkdown(formattedEndpoints);
    } else {
        ctx.reply('No chain selected. Please select a chain first.');
    }
});

bot.action('peer_nodes', async (ctx) => {
    const userId = ctx.from.id;
    const userAction = userLastAction[userId];
    if (userAction && userAction.chain) {
        const peer_nodes = await chainPeerNodes(userAction.chain);
        // Specify the parse mode for Markdown formatting
        ctx.reply(peer_nodes, { parse_mode: 'Markdown' });
    } else {
        ctx.reply('No chain selected. Please select a chain first.');
    }
});

bot.action('block_explorers', async (ctx) => {
    const userId = ctx.from.id;
    const userAction = userLastAction[userId];
    if (userAction && userAction.chain) {
        const block_explorers = await chainBlockExplorers(userAction.chain);
        // Send the list of block explorers using Markdown format for the URLs
        ctx.reply(block_explorers, { parse_mode: 'Markdown', disable_web_page_preview: true });
    } else {
        ctx.reply('No chain selected. Please select a chain first.');
    }
});

setInterval(periodicUpdateRepo, UPDATE_INTERVAL);
periodicUpdateRepo();

bot.launch().then(() => {
        console.log('Bot launched successfully');
}).catch(error => {
        console.log('Failed to launch the bot:', error);
});
