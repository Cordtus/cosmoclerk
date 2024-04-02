// menuFuncs.js

const { Markup } = require('telegraf');
const { updateUserLastAction, userLastAction, expectedAction, getChainList } = require('../utils');


function sendMainMenu(ctx, userId) {
    const userAction = userLastAction.get(userId);
    const mainMenuButtons = [
        Markup.button.callback('1. Chain Info', 'chain_info'),
        Markup.button.callback('2. Peer Nodes', 'peer_nodes'),
        Markup.button.callback('3. Endpoints', 'endpoints'),
        Markup.button.callback('4. Block Explorers', 'block_explorers'),
    ];

    // additional context options based on chain selection
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
    const userId = ctx.from.id;
    const userAction = userLastAction.get(userId);

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
                await chainEndpoints(ctx, userAction.chain);
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
                    await ctx.reply('Enter pool_id for osmosis:');
                    expectedAction[userId] = 'awaiting_pool_id';
                } else {
                    await ctx.reply('Pool incentives are only available for Osmosis.');
                }
                break;
            default:
                await ctx.reply('Invalid option selected. Please try again.');
                break;
            case 'pool_info':
                if (userAction.chain === 'osmosis') {
                    await ctx.reply('Enter pool_id for Osmosis:');
                    expectedAction[userId] = 'awaiting_pool_id_info';
                } else {
                    await ctx.reply('Pool info is only available for Osmosis.');
                }
                break;
                case 'price_info':
                if (userAction.chain === 'osmosis') {
                    await ctx.reply('Enter token ticker for Price Info:');
                    expectedAction[userId] = 'awaiting_token_ticker'; // Set the expected action to await ticker
                } else {
                    await ctx.reply('Price info is only available for Osmosis.');
                }
                break;

                    }
    } catch (error) {
        console.error(`Error handling action ${action}:`, error);
        await ctx.reply(`An error occurred while processing your request: ${error.message}`);
    }
}

// Function to either edit an existing message or send a new one
async function editOrSendMessage(ctx, userId, message, options = {}) {
    const userAction = userLastAction.get(userId);
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

function paginateChains(chains, currentPage, userId, pageSize) {
    console.log(`Paginating chains. Total chains: ${chains.length}, Current page: ${currentPage}, Page size: ${pageSize}`);

    const totalPages = Math.ceil(chains.length / pageSize);
    const start = currentPage * pageSize;
    const end = start + pageSize;
    const chainsToShow = chains.slice(start, end);
    const lastSelectedChain = userLastAction.get(userId)?.chain;

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

async function resetSessionAndShowChains(ctx) {
    const userId = ctx.from.id;
    // Clear the user's last action and expected action using session management functions
    userLastAction.delete(userId);
    expectedAction.delete(userId);

    // Fetch the updated chain list
    const chains = await getChainList();

    // Assuming getChainList is defined somewhere and pageSize is defined or imported
    const pageSize = 18; // Set your page size here or dynamically

    // Call paginateChains with the chains, default to the first page (0), pass the userId and pageSize
    const keyboard = paginateChains(chains, 0, userId, pageSize);

    // Send the chain selection message along with the generated keyboard markup
    await ctx.reply('Please select a chain:', keyboard);
}

module.exports = {
    sendMainMenu,
    handleMainMenuAction,
    editOrSendMessage,
    paginateChains,
    resetSessionAndShowChains,
    showTestnets,
};
