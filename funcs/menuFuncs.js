// menuFuncs.js

const sessionUtils = require('../utils/sessionUtils');
const { chainInfo, chainPeerNodes, chainEndpoints, chainBlockExplorers } = require('./chainFuncs');
const config = require('../config');
const path = require('path');

function sendMainMenu(userId) {
    userId = userId.toString();
    const userAction = sessionUtils.userLastAction[userId];
    const mainMenuButtons = [
        Markup.button.callback('1. Chain Info', 'chain_info'),
        Markup.button.callback('2. Peer Nodes', 'peer_nodes'),
        Markup.button.callback('3. Endpoints', 'endpoints'),
        Markup.button.callback('4. Block Explorers', 'block_explorers'),
    ];

    if (userAction && !userAction.browsingTestnets) {
        mainMenuButtons.push(Markup.button.callback('5. IBC-ID', 'ibc_id'));
        if (userAction.chain === 'osmosis') {
            mainMenuButtons.push(Markup.button.callback('6. LP Incentives', 'lp_incentives'));
            mainMenuButtons.push(Markup.button.callback('7. Pool Info', 'pool_info'));
        }
    }

    return Markup.inlineKeyboard(mainMenuButtons, { columns: 2 });
}

async function handleMainMenuAction(ctx, action) {
    const userId = ctx.from.id.toString();
    const userAction = sessionUtils.userLastAction[userId];

    if (!userAction || !userAction.chain) {
        await ctx.reply('No chain selected. Please select a chain first.');
        return;
    }

    try {
        // Check if user is browsing testnets and adjust directory path accordingly
        const directory = userAction.browsingTestnets ?
            path.join(config.repoDir, 'testnets', userAction.chain) :
            path.join(config.repoDir, userAction.chain);

        await handleAction(ctx, action, userAction.chain, directory);
    } catch (error) {
        console.error(`Error handling action ${action}:`, error);
        await ctx.reply(`An error occurred while processing your request: ${error.message}`);
    }
}

async function editOrSendMessage(ctx, userId, message, options = {}) {
    const userAction = sessionUtils.userLastAction[userId];
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
        sessionUtils.updateUserLastAction(userId, {
            messageId: sentMessage.message_id,
            chatId: sentMessage.chat.id
        });
    }
}

function paginateChains(chains, currentPage, userId, pageSize) {
    userId = userId.toString();
    const lastSelectedChain = sessionUtils.userLastAction[userId]?.chain;

    console.log(`Paginating chains. Total chains: ${chains.length}, Current page: ${currentPage}, Page size: ${pageSize}`);

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
    sessionUtils.updateUserLastAction(userId, { browsingTestnets: true });
}

async function selectChain(ctx, chainName, isTestnet = false) {
    const userId = ctx.from.id.toString();
    sessionUtils.updateUserLastAction(userId, { chain: chainName, browsingTestnets: isTestnet });
    await ctx.reply(`${isTestnet ? 'Testnet' : 'Chain'} ${chainName} selected. Please choose an option from the menu.`);
}

async function resetSessionAndShowChains(ctx) {
    const userId = ctx.from.id.toString();
    sessionUtils.updateUserLastAction(userId, null); // Clear session data for this user
    sessionUtils.updateExpectedAction(userId, null); // Also clear any expected action

    const chains = await getChainList();
    const pageSize = config.pageSize;
    const keyboard = paginateChains(chains, 0, userId, pageSize);
    await ctx.reply('Please select a chain:', keyboard);
}

module.exports = {
    editOrSendMessage,
    sendMainMenu,
    selectChain,
    handleMainMenuAction,
    paginateChains,
    resetSessionAndShowChains,
    showTestnets
};
