const path = require('path');
const { Markup } = require('telegraf');
const { chainInfo, chainPeerNodes, chainEndpoints, chainBlockExplorers, ibcIdFormatted, ibcIdRaw, poolInfo, poolIncentives, walletBalances } = require('./chainFuncs');
const { getUserLastAction, updateUserLastAction, updateExpectedAction, clearUserSession } = require('../utils/sessionUtils');
const { getChainList, getTestnetsList } = require('../utils/repoUtils');
const config = require('../config');

function sendMainMenu(ctx, userId) {
    const userAction = getUserLastAction(userId);
    const mainMenuButtons = [
        Markup.button.callback('1. Chain Info', 'chain_info'),
        Markup.button.callback('2. Peer Nodes', 'peer_nodes'),
        Markup.button.callback('3. Endpoints', 'endpoints'),
        Markup.button.callback('4. Block Explorers', 'block_explorers')
    ];

    if (!userAction.browsingTestnets) {
        mainMenuButtons.push(Markup.button.callback('5. IBC-ID', 'ibc_id'));
        if (userAction.chain === 'osmosis') {
            mainMenuButtons.push(Markup.button.callback('6. LP Incentives', 'pool_incentives'));
            mainMenuButtons.push(Markup.button.callback('7. Pool Info', 'pool_info'));
            mainMenuButtons.push(Markup.button.callback('8. Wallet Balances', 'wallet_balances'));
        }
    }

    return Markup.inlineKeyboard(mainMenuButtons, { columns: 2 });
}

// Function to handle main menu actions based on user selection
async function handleMainMenuAction(ctx, action) {
    const userId = ctx.from.id.toString();
    const userAction = getUserLastAction(userId);

    if (!userAction || !userAction.chain) {
        await ctx.reply('No chain selected. Please select a chain first.');
        return;
    }

    try {
        switch (action) {
            case 'chain_info':
                await chainInfo(ctx, userAction.chain);
                break;
            case 'peer_nodes':
                await chainPeerNodes(ctx, userAction.chain);
                break;
            case 'endpoints':
                await chainEndpoints(ctx, userAction.chain);
                break;
            case 'block_explorers':
                await chainBlockExplorers(ctx, userAction.chain);
                break;
            case 'ibc_id':
                await ctx.reply(`Enter IBC denom for ${userAction.chain}:`, { parse_mode: 'Markdown' });
                updateExpectedAction(userId, 'awaiting_ibc_denom');
                break;
            case 'pool_incentives':
                if (userAction.chain === 'osmosis') {
                    await ctx.reply('Enter pool_id for osmosis:');
                    updateExpectedAction(userId, 'awaiting_pool_id');
                } else {
                    await ctx.reply('Pool incentives are only available for Osmosis.');
                }
                break;
            case 'pool_info':
                if (userAction.chain === 'osmosis') {
                    await ctx.reply('Enter pool_id for Osmosis:');
                    updateExpectedAction(userId, 'awaiting_pool_id_info');
                } else {
                    await ctx.reply('Pool info is only available for Osmosis.');
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

async function editOrSendMessage(ctx, userId, message, options = {}) {
    const userAction = getUserLastAction(userId);
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
            await ctx.reply(message, options);
        }
    } else {
        const sentMessage = await ctx.reply(message, options);
        updateUserLastAction(userId, {
            messageId: sentMessage.message_id,
            chatId: sentMessage.chat.id
        });
    }
}

function paginateChains(chains, currentPage, userId, pageSize) {
    const lastSelectedChain = getUserLastAction(userId)?.chain;

    currentPage = parseInt(currentPage);
    pageSize = parseInt(pageSize);

    const totalPages = Math.ceil(chains.length / pageSize);
    const start = currentPage * pageSize;
    const end = start + pageSize;
    const chainsToShow = chains.slice(start, end);

    const buttons = chainsToShow.map(chain => {
        const buttonText = chain === lastSelectedChain ? `🔴 ${chain}` : chain;
        return Markup.button.callback(buttonText, `select_chain:${chain}`);
    });

    const navigationButtons = [];
    if (currentPage > 0) {
        navigationButtons.push(Markup.button.callback('← Previous', `page:${currentPage - 1}`));
    }
    if (currentPage < totalPages - 1) {
        navigationButtons.push(Markup.button.callback('Next →', `page:${currentPage + 1}`));
    }

    const rowsOfButtons = [...buttons.reduce((rows, button, index) => {
        if (index % 3 === 0) rows.push([]);
        rows[rows.length - 1].push(button);
        return rows;
    }, []), navigationButtons];

    return Markup.inlineKeyboard(rowsOfButtons);
}

async function showTestnets(ctx) {
    const userId = ctx.from.id.toString();
    const testnetsList = await getTestnetsList();
    const keyboardMarkup = paginateChains(testnetsList, 0, userId, config.pageSize);
    await ctx.reply('Select a testnet:', keyboardMarkup);
    updateUserLastAction(userId, { browsingTestnets: true });
}

async function selectChain(ctx, chainName, isTestnet = false) {
    const userId = ctx.from.id.toString();
    updateUserLastAction(userId, { chain: chainName, browsingTestnets: isTestnet });
    await ctx.reply(`${isTestnet ? 'Testnet' : 'Chain'} ${chainName} selected. Please choose an option from the menu.`);
}

async function resetSessionAndShowChains(ctx) {
    const userId = ctx.from.id.toString();
    clearUserSession(userId);
    const chains = await getChainList();
    const keyboard = paginateChains(chains, 0, userId, config.pageSize);
    await ctx.reply('Please select a chain:', keyboard);
}

module.exports = {
    paginateChains,
    sendMainMenu,
    handleMainMenuAction,
    editOrSendMessage,
    resetSessionAndShowChains,
    showTestnets,
    selectChain
};
