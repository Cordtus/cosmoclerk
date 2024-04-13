// menuFuncs.js

const { Markup } = require('telegraf');
const { updateUserLastAction, userLastAction, expectedAction } = require('../utils/sessionUtils');
const { getChainList } = require('../utils/repoUtils');

function sendMainMenu(ctx, userId) {
    const userAction = userLastAction[userId];
    const mainMenuButtons = [
        Markup.button.callback('1. Chain Info', 'chain_info'),
        Markup.button.callback('2. Peer Nodes', 'peer_nodes'),
        Markup.button.callback('3. Endpoints', 'endpoints'),
        Markup.button.callback('4. Block Explorers', 'block_explorers'),
    ];

    if (userAction && !userAction.browsingTestnets) {
        mainMenuButtons.push(Markup.button.callback('5. IBC-ID', 'ibc_id'));
        if (userAction.chain === 'osmosis') {
            mainMenuButtons.push(Markup.button.callback('6. LP Incentives', 'pool_incentives'));
            mainMenuButtons.push(Markup.button.callback('7. Pool Info', 'pool_info'));
            mainMenuButtons.push(Markup.button.callback('8. Price Info', 'price_info'));
        }
    }

    return Markup.inlineKeyboard(mainMenuButtons, { columns: 2 });
}

async function handleMainMenuAction(ctx, action, chain) {
    const userId = ctx.from.id.toString();
    const userAction = userLastAction[userId];

    if (!userAction || !userAction.chain) {
        await ctx.reply('No chain selected. Please select a chain first.');
        return;
    }

    // Handling based on the action provided by user interaction
    try {
        switch (action) {
            // Various cases handling different actions: chain_info, peer_nodes, etc.
            // Similar to previous code, with adjustments to userLastAction and expectedAction usage
            // Example:
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
            // Additional cases as needed...

            default:
                await ctx.reply('Invalid option selected. Please try again.');
                break;
        }
    } catch (error) {
        console.error(`Error handling action ${action}:`, error);
        await ctx.reply(`An error occurred while processing your request: ${error.message}`);
    }
}

// Other functions like editOrSendMessage, paginateChains, showTestnets, and resetSessionAndShowChains
// Adjusted similarly to handle userLastAction and expectedAction as plain objects

module.exports = {
    sendMainMenu,
    handleMainMenuAction,
    editOrSendMessage,
    paginateChains,
    resetSessionAndShowChains,
    showTestnets,
};
