// handlers.js

const config = require('./config');
const sessionUtils = require('./utils/sessionUtils');
const { checkRepoStaleness, getChainList } = require('./utils/repoUtils');
const { chainInfo, chainEndpoints, chainPeerNodes, chainBlockExplorers, ibcId, poolIncentives } = require('./utils/chainUtils');
const { sendMainMenu, handleMainMenuAction, editOrSendMessage, paginateChains, resetSessionAndShowChains, showTestnets } = require('./funcs/menuFuncs');


module.exports = function registerHandlers(bot) {
    bot.command(['start', 'restart'], async (ctx) => {
        const userId = ctx.from.id.toString();
        updateUserLastAction(userId, null);
        sessionUtils.updateExpectedAction(userId, null);
        
        const isRepoStale = await checkRepoStaleness(config.repoDir, config.staleHours);
        if (isRepoStale) {
            await cloneOrUpdateRepo();
        }

        await resetSessionAndShowChains(ctx);
    });

    bot.action(/^select_chain:(.+)$/, async (ctx) => {
        const chain = ctx.match[1];
        const userId = ctx.from.id.toString();
    
        if (chain === 'testnets') {
            // Handle testnets separately if needed
            await showTestnets(ctx, userId);
        } else {
            // Update user's last action with the selected chain
            await updateUserLastAction(userId, { chain: chain, browsingTestnets: false });
            const keyboardMarkup = await sendMainMenu(ctx, userId); // Ensure sendMainMenu is awaited if it's async
            await ctx.reply('Select an action:', keyboardMarkup);
        }
    });
    
    bot.on('text', async (ctx) => {
        const text = ctx.message.text.trim().toLowerCase();
        const userId = ctx.from.id.toString(); // Ensure ID is treated as a string consistently
    
        const currentAction = sessionUtils.expectedAction[userId]; // Get the current expected action
    
        if (text === '/start' || text === '/restart') {
            await resetSessionAndShowChains(ctx);
        } else if (currentAction === 'awaiting_pool_id') {
            const poolId = parseInt(text, 10);
            if (isNaN(poolId)) {
                await ctx.reply('Please enter a valid pool_id.');
            } else {
                await poolIncentives(ctx, poolId);
                sessionUtils.updateExpectedAction(userId, null); // Clear the expected action after handling
            }
        } else if (currentAction === 'awaiting_pool_id_info') {
            const poolId = parseInt(text, 10);
            if (isNaN(poolId)) {
                await ctx.reply('Please enter a valid pool_id for Pool Info.');
            } else {
                await poolInfo(ctx, poolId);
                sessionUtils.updateExpectedAction(userId, null); // Clear the expected action after handling
            }
        } else if (!isNaN(text)) {
            const optionIndex = parseInt(text, 10) - 1;
            const mainMenuOptions = ['chain_info', 'peer_nodes', 'endpoints', 'block_explorers', 'ibc_id', 'pool_incentives', 'pool_info'];
    
            const userAction = sessionUtils.userLastAction[userId]; // Get the user action from sessionUtils
            if (userAction && userAction.chain && optionIndex >= 0 && optionIndex < mainMenuOptions.length) {
                const action = mainMenuOptions[optionIndex];
                await handleMainMenuAction(ctx, action, userAction.chain);
            } else {
                await ctx.reply('Invalid option number or no chain selected. Please try again or select a chain first.');
            }
        } else if (text.startsWith('ibc/')) {
            const ibcHash = text.slice(4); // Extract the IBC hash
            const userAction = sessionUtils.userLastAction[userId]; // Get the user action from sessionUtils
            if (userAction && userAction.chain) {
                const baseDenom = await ibcId(ctx, ibcHash, userAction.chain);
                if (baseDenom) {
                    ctx.reply(`Base Denomination: ${baseDenom}`);
                } else {
                    ctx.reply('Failed to fetch IBC information.');
                }
            } else {
                ctx.reply('No chain selected. Please select a chain first.');
            }
        } else {
            const chains = await getChainList();
            if (chains.map(chain => chain.toLowerCase()).includes(text)) {
                sessionUtils.updateUserLastAction(userId, { chain: text });
                const keyboardMarkup = sendMainMenu(ctx, userId);
                await ctx.reply('Select an action:', keyboardMarkup);
            } else {
                await ctx.reply('Unrecognized command. Please try again or use the menu options.');
            }
        }
    });
    
    bot.action(/page:(\d+)/, async (ctx) => {
        try {
            const page = parseInt(ctx.match[1]);
            const userId = ctx.from.id.toString(); // Ensure consistent user ID handling
    
            // Determine if the user is browsing testnets or main chains
            const userAction = userLastAction[userId];
            const browsingTestnets = userAction ? userAction.browsingTestnets : false;
    
            // Fetch the appropriate chain list based on user selection
            const chains = browsingTestnets ? 
                await getChainList(path.join(config.repoDir, 'testnets')) : // Adjust path as necessary for your structure
                await getChainList();
    
            if (chains.length === 0) {
                await ctx.reply('No chains available.');
                return; // Exit early if no chains to display
            }
    
            if (page < 0 || page >= Math.ceil(chains.length / config.pageSize)) {
                await ctx.reply('Invalid page number.');
                return; // Exit early if an invalid page number was requested
            }
    
            const pageSize = config.pageSize;
    
            // Generate keyboard for the requested page
            const keyboardMarkup = paginateChains(chains, page, userId, pageSize);
    
            if (!keyboardMarkup || keyboardMarkup.inline_keyboard.length === 0) {
                await ctx.reply('Unable to generate navigation buttons.');
                return; // Exit early if unable to generate keyboard markup
            }
    
            // Edit previous message with the new page's content
            await ctx.editMessageReplyMarkup({
                inline_keyboard: keyboardMarkup.inline_keyboard,
                chat_id: ctx.callbackQuery.message.chat.id,
                message_id: ctx.callbackQuery.message.message_id,
            });
        } catch (error) {
            console.error(`Error in page action: ${error}`);
            await ctx.reply('An error occurred while processing your request.');
        }
    });

    bot.action('chain_info', async (ctx) => {
        const userId = ctx.from.id.toString(); // Ensure ID is treated as a string
        const userAction = userLastAction[userId];
    
        if (userAction && userAction.chain) {
            try {
                const chainInfoResult = await chainInfo(ctx, userAction.chain); // Assume chainInfo correctly fetches the data based on chain
                if (chainInfoResult && chainInfoResult.message) {
                    await editOrSendMessage(ctx, userId, chainInfoResult.message, {
                        parse_mode: 'Markdown',
                        disable_web_page_preview: true,
                    });
                } else {
                    throw new Error("Chain information is unavailable.");
                }
            } catch (error) {
                console.error(`Error fetching chain info for ${userAction.chain}:`, error);
                await ctx.reply('Failed to fetch chain info.');
            }
        } else {
            await ctx.reply('No chain selected. Please select a chain first.');
        }
    });

    bot.action('endpoints', async (ctx) => {
        const userId = ctx.from.id.toString(); // Consistent string handling for user ID
        const userAction = userLastAction[userId];
    
        if (userAction && userAction.chain) {
            try {
                const endpoints = await chainEndpoints(ctx, userAction.chain); // Assume chainEndpoints fetches data based on chain
    
                if (!endpoints || typeof endpoints !== 'string' || !endpoints.trim()) {
                    throw new Error("Endpoints data is unexpectedly empty.");
                }
    
                console.log('Formatted Endpoints:', endpoints);
                await editOrSendMessage(ctx, userId, endpoints, {
                    parse_mode: 'Markdown',
                    disable_web_page_preview: true,
                });
            } catch (error) {
                console.error(`Error fetching endpoints for ${userAction.chain}:`, error);
                await ctx.reply('Error: Received unexpectedly empty data.');
            }
        } else {
            await ctx.reply('No chain selected. Please select a chain first.');
        }
    });

    bot.action('peer_nodes', async (ctx) => {
        const userId = ctx.from.id.toString(); // Consistent string handling for userId
        const userAction = userLastAction[userId];
        if (userAction && userAction.chain) {
            try {
                const peer_nodes = await chainPeerNodes(ctx, userAction.chain);
                // Ensure peer_nodes has content before attempting to send/edit
                if (!peer_nodes.trim()) throw new Error('Peer nodes information is currently unavailable.');
    
                await editOrSendMessage(ctx, userId, peer_nodes, { parse_mode: 'Markdown', disable_web_page_preview: true });
            } catch (error) {
                console.error(`Error fetching peer nodes for ${userAction.chain}:`, error);
                await ctx.reply('An error occurred while fetching peer nodes information.');
            }
        } else {
            await ctx.reply('No chain selected. Please select a chain first.');
        }
    });

    bot.action('block_explorers', async (ctx) => {
        const userId = ctx.from.id.toString(); // Uniform handling of userId as a string
        const userAction = userLastAction[userId];
        if (userAction && userAction.chain) {
            try {
                const block_explorers = await chainBlockExplorers(ctx, userAction.chain);
                // Check for content in block_explorers before proceeding
                if (!block_explorers.trim()) throw new Error('Block explorer information is currently unavailable.');
    
                await editOrSendMessage(ctx, userId, block_explorers, { parse_mode: 'Markdown', disable_web_page_preview: true });
            } catch (error) {
                console.error(`Error fetching block explorers for ${userAction.chain}:`, error);
                await ctx.reply('An error occurred while fetching block explorer information.');
            }
        } else {
            await ctx.reply('No chain selected. Please select a chain first.');
        }
    });

    bot.action('ibc_id', async (ctx) => {
        const userId = ctx.from.id.toString();
        const userAction = userLastAction[userId];
        if (userAction && userAction.chain) {
            sessionUtils.updateExpectedAction(userId, 'awaiting_ibc_denom'); // Set expected IBC denom entry
            await ctx.reply(`Enter IBC denom for ${userAction.chain}:`);
        } else {
            await ctx.reply('No chain selected. Please select a chain first.');
        }
    });
    
    bot.action('pool_incentives', async (ctx) => {
        const userId = ctx.from.id.toString();
        const userAction = userLastAction[userId];
        if (userAction && userAction.chain) {
            sessionUtils.updateExpectedAction(userId, 'awaiting_pool_id'); // Now expecting a pool ID
            await ctx.reply(`Enter pool_id for ${userAction.chain}:`);
        } else {
            await ctx.reply('No chain selected. Please select a chain first.');
        }
    });
    
    bot.action('pool_info', async (ctx) => {
        const userId = ctx.from.id.toString();
        const userAction = userLastAction[userId];
        if (userAction && userAction.chain === 'osmosis') {
            sessionUtils.updateExpectedAction(userId, 'awaiting_pool_id_info'); // Now expecting a pool ID for info
            await ctx.reply('Enter pool_id for Osmosis:');
        } else {
            await ctx.reply('The "Pool Info" feature is only available for the Osmosis chain.');
        }
    });

    module.exports = registerHandlers;
}
