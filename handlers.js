const { Markup } = require('telegraf');
const repoUtils = require('./utils/repoUtils');
const { updateUserLastAction, getUserLastAction, updateExpectedAction } = require('./utils/sessionUtils');
const chainFuncs = require('./funcs/chainFuncs');
const menuFuncs = require('./funcs/menuFuncs');
const config = require('./config');

function registerHandlers(bot) {
    bot.start((ctx) => {
        const userId = ctx.from.id.toString();
        updateUserLastAction(userId, { action: 'start' });
        ctx.reply('Welcome! Use /menu to get started.');
    });

    bot.command('menu', async (ctx) => {
        const userId = ctx.from.id.toString();
        const mainMenu = menuFuncs.sendMainMenu(ctx, userId);
        await ctx.reply('Please choose an option from the menu:', mainMenu);
    });

    bot.command('testnets', async (ctx) => {
        const userId = ctx.from.id.toString();
        updateUserLastAction(userId, { browsingTestnets: true });
        const chains = await repoUtils.getChainList('testnets');
        const keyboardMarkup = menuFuncs.paginateChains(chains, 0, userId, config.pageSize);
        await ctx.reply('Select a testnet:', keyboardMarkup);
    });

    bot.command('chains', async (ctx) => {
        const userId = ctx.from.id.toString();
        updateUserLastAction(userId, { browsingTestnets: false });
        const chains = await repoUtils.getChainList();
        const keyboardMarkup = menuFuncs.paginateChains(chains, 0, userId, config.pageSize);
        await ctx.reply('Select a chain:', keyboardMarkup);
    });

    bot.action(/select_chain:(.+)/, async (ctx) => {
        const chainName = ctx.match[1];
        const userId = ctx.from.id.toString();
        updateUserLastAction(userId, { chain: chainName });
        await ctx.answerCallbackQuery();
        await chainFuncs.checkChainHealth(ctx, chainName); // Check endpoints health when chain is selected
        await ctx.reply(`${chainName} selected. Please choose an option from the menu.`, menuFuncs.sendMainMenu(ctx, userId));
    });

    bot.action(/page:(\d+)/, async (ctx) => {
        try {
            const page = parseInt(ctx.match[1]);
            const userId = ctx.from.id.toString();
            const userAction = getUserLastAction(userId);
            const browsingTestnets = userAction ? userAction.browsingTestnets : false;
            const chains = browsingTestnets ? await repoUtils.getChainList('testnets') : await repoUtils.getChainList();

            if (chains.length === 0) {
                await ctx.reply('No chains available.');
                return;
            }

            if (page < 0 || page >= Math.ceil(chains.length / config.pageSize)) {
                await ctx.reply('Invalid page number.');
                return;
            }

            const keyboardMarkup = menuFuncs.paginateChains(chains, page, userId, config.pageSize);
            if (!keyboardMarkup || keyboardMarkup.inline_keyboard.length === 0) {
                await ctx.reply('Unable to generate navigation buttons.');
                return;
            }

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

    bot.action(/.+/, async (ctx) => {
        const action = ctx.callbackQuery.data;
        const userId = ctx.from.id.toString();
        const userAction = getUserLastAction(userId);

        if (userAction && userAction.chain) {
            try {
                await menuFuncs.handleMainMenuAction(ctx, action);
            } catch (error) {
                console.error(`Error handling action ${action}:`, error);
                await ctx.reply(`An error occurred while processing your request: ${error.message}`);
            }
        } else {
            await ctx.reply('No chain selected. Please select a chain first.');
        }
    });

    bot.on('text', async (ctx) => {
        const text = ctx.message.text.trim().toLowerCase();
        const userId = ctx.from.id.toString();
        const userAction = getUserLastAction(userId);

        if (text === '/start' || text === '/restart') {
            await menuFuncs.resetSessionAndShowChains(ctx);
        } else if (userAction && userAction.expectedAction === 'awaiting_pool_id') {
            const poolId = parseInt(text, 10);
            if (isNaN(poolId)) {
                await ctx.reply('Please enter a valid pool_id.');
            } else {
                await chainFuncs.poolIncentives(ctx, poolId);
                updateExpectedAction(userId, null);
            }
        } else if (userAction && userAction.expectedAction === 'awaiting_pool_id_info') {
            const poolId = parseInt(text, 10);
            if (isNaN(poolId)) {
                await ctx.reply('Please enter a valid pool_id for Pool Info.');
            } else {
                await chainFuncs.poolInfo(ctx, poolId);
                updateExpectedAction(userId, null);
            }
        } else if (userAction && userAction.expectedAction === 'awaiting_ibc_denom') {
            const ibcHash = text.startsWith('ibc/') ? text.slice(4) : text;
            if (userAction && userAction.chain) {
                const baseDenom = await chainFuncs.ibcIdFormatted(ctx, ibcHash, userAction.chain);
                if (baseDenom) {
                    ctx.reply(`Base Denomination: ${baseDenom}`);
                } else {
                    ctx.reply('Failed to fetch IBC information.');
                }
                updateExpectedAction(userId, null);
            } else {
                ctx.reply('No chain selected. Please select a chain first.');
            }
        } else if (!isNaN(text)) {
            const optionIndex = parseInt(text, 10) - 1;
            const mainMenuOptions = ['chain_info', 'peer_nodes', 'endpoints', 'block_explorers', 'ibc_id', 'pool_incentives', 'pool_info', 'wallet_balances'];
            if (userAction && userAction.chain && optionIndex >= 0 && optionIndex < mainMenuOptions.length) {
                const action = mainMenuOptions[optionIndex];
                await menuFuncs.handleMainMenuAction(ctx, action);
            } else {
                await ctx.reply('Invalid option number or no chain selected. Please try again or select a chain first.');
            }
        } else if (text.startsWith('ibc/')) {
            const ibcHash = text.slice(4);
            if (userAction && userAction.chain) {
                const baseDenom = await chainFuncs.ibcIdFormatted(ctx, ibcHash, userAction.chain);
                if (baseDenom) {
                    ctx.reply(`Base Denomination: ${baseDenom}`);
                } else {
                    ctx.reply('Failed to fetch IBC information.');
                }
            } else {
                ctx.reply('No chain selected. Please select a chain first.');
            }
        } else {
            const browsingTestnets = getUserLastAction(userId)?.browsingTestnets;
            const chains = await repoUtils.getChainList(browsingTestnets ? 'testnets' : '');
            if (chains.map(chain => chain.toLowerCase()).includes(text)) {
                updateUserLastAction(userId, { chain: text, browsingTestnets });
                const keyboardMarkup = menuFuncs.sendMainMenu(ctx, userId);
                await ctx.reply('Select an action:', keyboardMarkup);
            } else {
                await ctx.reply('Unrecognized command. Please try again or use the menu options.');
            }
        }
    });
}

module.exports = { registerHandlers };
