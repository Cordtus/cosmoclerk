// handlers.js

const repoUtils = require('./utils/repoUtils');
const sessionUtils = require('./utils/sessionUtils');
const chainFuncs = require('./funcs/chainFuncs');
const menuFuncs = require('./funcs/menuFuncs');



function registerHandlers(bot) {
    bot.command('testnets', async (ctx) => {
        const userId = ctx.from.id.toString();
        sessionUtils.updateUserLastAction(userId, { browsingTestnets: true });
        const chains = await repoUtils.getChainList('testnets');
        const keyboardMarkup = menuFuncs.paginateChains(chains, 0, userId, config.pageSize);
        await ctx.reply('Select a testnet:', keyboardMarkup);
    });
    // Command to list main chains
    bot.command('chains', async (ctx) => {
        const userId = ctx.from.id.toString();
        sessionUtils.updateUserLastAction(userId, { browsingTestnets: false });
        const chains = await repoUtils.getChainList();
        const keyboardMarkup = menuFuncs.paginateChains(chains, 0, userId, config.pageSize);
        await ctx.reply('Select a chain:', keyboardMarkup);
    });

    bot.action(/^select_chain:(.+)$/, async (ctx) => {
        const chain = ctx.match[1];
        const userId = ctx.from.id.toString();
        const browsingTestnets = sessionUtils.getUserLastAction(userId)?.browsingTestnets;
        sessionUtils.updateUserLastAction(userId, { chain: chain, browsingTestnets: browsingTestnets });
        const keyboardMarkup = await menuFuncs.sendMainMenu(ctx, userId);
        await ctx.reply('Select an action:', keyboardMarkup);
    });

    // Text handler for various commands and navigation
    bot.on('text', async (ctx) => {
        const text = ctx.message.text.trim().toLowerCase();
        const userId = ctx.from.id.toString();
        const userAction = sessionUtils.getUserLastAction(userId);

        if (text === '/start' || text === '/restart') {
            await menuFuncs.resetSessionAndShowChains(ctx);
        } else if (userAction === 'awaiting_pool_id') {
            const poolId = parseInt(text, 10);
            if (isNaN(poolId)) {
                await ctx.reply('Please enter a valid pool_id.');
            } else {
                await chainFuncs.poolIncentives(ctx, poolId);
                sessionUtils.updateExpectedAction(userId, null);
            }
        } else if (userAction === 'awaiting_pool_id_info') {
            const poolId = parseInt(text, 10);
            if (isNaN(poolId)) {
                await ctx.reply('Please enter a valid pool_id for Pool Info.');
            } else {
                await chainFuncs.poolInfo(ctx, poolId);
                sessionUtils.updateExpectedAction(userId, null);
            }
        } else if (!isNaN(text)) {
            const optionIndex = parseInt(text, 10) - 1;
            const mainMenuOptions = ['chain_info', 'peer_nodes', 'endpoints', 'block_explorers', 'ibc_id', 'pool_incentives', 'pool_info'];
    
            const userAction = sessionUtils.getUserLastAction(userId);
            if (userAction && userAction.chain && optionIndex >= 0 && optionIndex < mainMenuOptions.length) {
                const action = mainMenuOptions[optionIndex];
                await menuFuncs.handleMainMenuAction(ctx, action, userAction.chain);
            } else {
                await ctx.reply('Invalid option number or no chain selected. Please try again or select a chain first.');
            }
        } else if (text.startsWith('ibc/')) {
            const ibcHash = text.slice(4);
            const userAction = sessionUtils.getUserLastAction(userId);
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
            const browsingTestnets = sessionUtils.getUserLastAction(userId)?.browsingTestnets;
            const chains = await getChainList(browsingTestnets ? 'testnets' : '');
            if (chains.map(chain => chain.toLowerCase()).includes(text)) {
                sessionUtils.updateUserLastAction(userId, { chain: text, browsingTestnets: browsingTestnets });
                const keyboardMarkup = await menuFuncs.sendMainMenu(ctx, userId);
                await ctx.reply('Select an action:', keyboardMarkup);
            } else {
                await ctx.reply('Unrecognized command. Please try again or use the menu options.');
            }
        }
    });
    
    // Page navigation for chains list
    bot.action(/page:(\d+)/, async (ctx) => {
        try {
            const page = parseInt(ctx.match[1]);
            const userId = ctx.from.id.toString();
    
            // Determine if the user is browsing testnets or main chains
            const userAction = sessionUtils.getUserLastAction(userId);
            const browsingTestnets = userAction ? userAction.browsingTestnets : false;
    
            // Fetch the appropriate chain list based on user selection
            const chains = browsingTestnets ? 
                await repoUtils.getChainList('testnets') : 
                await repoUtils.getChainList();
    
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
            const keyboardMarkup = menuFuncs.paginateChains(chains, page, userId, pageSize);
    
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
        const userId = ctx.from.id.toString();
        const userAction = sessionUtils.getUserLastAction(userId);
        if (userAction && userAction.chain) {
            try {
                const chainInfoResult = await chainFuncs.chainInfo(ctx, userAction.chain);
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
        const userId = ctx.from.id.toString();
        const userAction = sessionUtils.getUserLastAction(userId);
        if (userAction && userAction.chain) {
            try {
                const endpoints = await chainFuncs.chainEndpoints(ctx, userAction.chain);
                if (!endpoints || !endpoints.trim()) {
                    throw new Error("Endpoints data is unexpectedly empty.");
                }
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
        const userId = ctx.from.id.toString();
        const userAction = sessionUtils.getUserLastAction(userId);
        if (userAction && userAction.chain) {
            try {
                const peerNodes = await chainFuncs.chainPeerNodes(ctx, userAction.chain);
                if (!peerNodes.trim()) {
                    throw new Error('Peer nodes information is currently unavailable.');
                }
                await menuFuncs.editOrSendMessage(ctx, userId, peerNodes, { parse_mode: 'Markdown', disable_web_page_preview: true });
            } catch (error) {
                console.error(`Error fetching peer nodes for ${userAction.chain}:`, error);
                await ctx.reply('An error occurred while fetching peer nodes information.');
            }
        } else {
            await ctx.reply('No chain selected. Please select a chain first.');
        }
    });

    bot.action('block_explorers', async (ctx) => {
        const userId = ctx.from.id.toString();
        const userAction = sessionUtils.getUserLastAction(userId);
        if (userAction && userAction.chain) {
            try {
                const blockExplorers = await chainFuncs.chainBlockExplorers(ctx, userAction.chain);
                if (!blockExplorers.trim()) {
                    throw new Error('Block explorer information is currently unavailable.');
                }
                await menuFuncs.editOrSendMessage(ctx, userId, blockExplorers, { parse_mode: 'Markdown', disable_web_page_preview: true });
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
        const userAction = sessionUtils.getUserLastAction(userId);
        if (userAction && userAction.chain) {
            sessionUtils.updateExpectedAction(userId, 'awaiting_ibc_denom');
            await ctx.reply(`Enter IBC denom for ${userAction.chain}:`);
        } else {
            await ctx.reply('No chain selected. Please select a chain first.');
        }
    });

    bot.action('pool_incentives', async (ctx) => {
        const userId = ctx.from.id.toString();
        const userAction = sessionUtils.getUserLastAction(userId);
        if (userAction && userAction.chain) {
            sessionUtils.updateExpectedAction(userId, 'awaiting_pool_id');
            await ctx.reply(`Enter pool_id for ${userAction.chain}:`);
        } else {
            await ctx.reply('No chain selected. Please select a chain first.');
        }
    });

    bot.action('pool_info', async (ctx) => {
        const userId = ctx.from.id.toString();
        const userAction = sessionUtils.getUserLastAction(userId);
        if (userAction && userAction.chain === 'osmosis') {
            sessionUtils.updateExpectedAction(userId, 'awaiting_pool_id_info');
            await ctx.reply('Enter pool_id for Osmosis:');
        } else {
            await ctx.reply('The "Pool Info" feature is only available for the Osmosis chain.');
        }
    });

};
    module.exports = registerHandlers;