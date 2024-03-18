// handlers.js
const { updateUserLastAction, userLastAction, expectedAction } = require('./utils/sessionUtils');
const { handlePriceInfo, handlePoolIncentives, handlePoolInfo, chainInfo, chainEndpoints, chainPeerNodes, chainBlockExplorers } = require('./funcs/chainFuncs');
const { sendMainMenu, paginateChains, resetSessionAndShowChains } = require('./funcs/menuFuncs');
const config = require('./config');

function registerHandlers(bot) {
    bot.command('restart', async (ctx) => {
        await resetSessionAndShowChains(ctx);
    });

    bot.action(/^select_chain:(.+)$/, async (ctx) => {
    const chain = ctx.match[1];
    const userId = ctx.from.id;

    if (chain === 'testnets') {
        // Assuming you have a separate directory for testnets
        const testnetsDir = pat// config.js

        const path = require('path');
        
        const staleHours = 6; // Defined outside of module.exports so it can be used within
        
        const config = {
            pageSize: 18,
            repoUrl: "https://github.com/cosmos/chain-registry.git",
            repoDir: path.join(__dirname, 'chain-registry'), // Make sure this directory exists
            staleHours: staleHours,
            updateInterval: staleHours * 3600000, // Calculate the updateInterval using staleHours
        };
        
        module.exports = config;
        h.join(REPO_DIR, 'testnets');
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

// Text handler
bot.on('text', async (ctx) => {
    const text = ctx.message.text.trim().toLowerCase();
    const userId = ctx.from.id;

    if (!userLastAction[userId]) {
        userLastAction[userId] = {}; // Initialize if not exist
    }

    const userAction = userLastAction[userId];
    if (text === '/start' || text === '/restart') {
        await resetSessionAndShowChains(ctx);
    //  'awaiting_token_ticker' expected action
    } else if (expectedAction[userId] === 'awaiting_token_ticker') {
        // Call the function to handle Price Info
        await handlePriceInfo(ctx, text);
        delete expectedAction[userId]; // Clear the expected action after handling
    } else if (expectedAction[userId] === 'awaiting_pool_id') {
        // Handle pool ID input for Pool Incentives
        const poolId = parseInt(text, 10);
        if (isNaN(poolId)) {
            await ctx.reply('Please enter a valid pool_id.');
        } else {
            await handlePoolIncentives(ctx, poolId);
            delete expectedAction[userId];
        }
    } else if (expectedAction[userId] === 'awaiting_pool_id_info') { // New condition for Pool Info
        // Assuming pool IDs are numeric. Adjust if your IDs are different.
        const poolId = parseInt(text, 10);
        if (isNaN(poolId)) {
            await ctx.reply('Please enter a valid pool_id for Pool Info.');
        } else {
            await handlePoolInfo(ctx, poolId); // Call the function to handle Pool Info
            delete expectedAction[userId]; // Clear the expected action after handling
        }
    } else if (!isNaN(text)) {
        // Numeric input for menu selection
        const optionIndex = parseInt(text) - 1;
        const mainMenuOptions = ['chain_info', 'peer_nodes', 'endpoints', 'block_explorers', 'ibc_id', 'pool_incentives', 'pool_info', 'price_info'];
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
        // Within bot.on('text', async (ctx) => { ... })
        } else if (text.startsWith('ibc/')) {
            const ibcHash = text.slice(4); // Extract the IBC hash
            if (userAction && userAction.chain) {
            const baseDenom = await queryIbcId(ctx, ibcHash, userAction.chain, true);
            if (baseDenom) {
            ctx.reply(`Base Denomination: ${baseDenom}`);
            } else {
            ctx.reply('Failed to fetch IBC denom trace or it does not exist.');
        }
        } else {
            ctx.reply('No chain selected. Please select a chain first.');
        }
}
 else {
        const chains = await getChainList();
        // Adjust chain names to lowercase before comparison
        if (chains.map(chain => chain.toLowerCase()).includes(text)) {
            // Convert the selected chain to its original case as needed or maintain lowercase
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
        const chainInfoResult = await chainInfo(ctx, userAction.chain);
        if (chainInfoResult && chainInfoResult.message) {
            await editOrSendMessage(ctx, userId, chainInfoResult.message, {
                parse_mode: 'Markdown',
                disable_web_page_preview: true,
            });
        } else {
            console.error('Unexpected result from chainInfo:', chainInfoResult);
            await ctx.reply('Failed to fetch chain info.');
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

        if (!endpoints || typeof endpoints !== 'string' || !endpoints.trim()) {
            console.error(`Endpoints data is unexpectedly empty for chain ${userAction.chain}.`);
            await ctx.reply('Error: Received unexpectedly empty data.');
            return; // Ensure to return here to prevent further execution
        }

        console.log('Formatted Endpoints:', endpoints);
        try {
            if (userAction.messageId) {
                await ctx.telegram.editMessageText(
                    userAction.chatId,
                    userAction.messageId,
                    null,
                    endpoints,
                    {
                        parse_mode: 'Markdown',
                        disable_web_page_preview: true,
                    }
                );
            } else {
                const sentMessage = await ctx.reply(endpoints, { parse_mode: 'Markdown' });
                updateUserLastAction(userId, {
                    messageId: sentMessage.message_id,
                    chatId: sentMessage.chat.id
                });
            }
        } catch (error) {
            console.error('Error editing message:', error);
            // Since the catch block does not contain a reply, consider adding one if needed
        }
    } else {
        await ctx.reply('No chain selected. Please select a chain first.');
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
        await ctx.reply(`Enter pool_id for ${userAction.chain}:`);
        expectedAction[userId] = 'awaiting_pool_id';
    } else {
        await ctx.reply('No chain selected. Please select a chain first.');
    }
});

bot.action('price_info', async (ctx) => {
    const userId = ctx.from.id;
    const userAction = userLastAction[userId];
    if (userAction && userAction.chain === 'osmosis') {
        await ctx.reply('Enter token ticker for Price Info:');
        expectedAction[userId] = 'awaiting_token_ticker'; // Prepare to handle the token ticker input
    } else {
        await ctx.reply('Price info is only available for Osmosis.');
    }
});

bot.action('pool_info', async (ctx) => {
    const userId = ctx.from.id;
    const userAction = userLastAction[userId];
    if (userAction && userAction.chain === 'osmosis') {
        await ctx.reply('Enter pool_id for Osmosis:');
        expectedAction[userId] = 'awaiting_pool_id_info'; // Set the expected action to await pool ID input
    } else {
        await ctx.reply('The "Pool Info" feature is only available for the Osmosis chain.');
    }
});

};

module.exports = registerHandlers;
