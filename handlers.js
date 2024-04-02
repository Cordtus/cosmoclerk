// handlers.js
const {
    userLastAction,
    updateUserLastAction,
    expectedAction,
    getChainList,
    chainInfo,
    chainEndpoints,
    chainPeerNodes,
    chainBlockExplorers,
    queryIbcId,
    handlePoolIncentives
  } = require('./utils'); // Consolidated utility imports from utils/index.js
  
  const {
    handlePriceInfo,
    handlePoolInfo,
    sendMainMenu,
    paginateChains,
    resetSessionAndShowChains,
    handleMainMenuAction,
    editOrSendMessage
  } = require('./funcs'); // Consolidated function imports from funcs/index.js
  
  const config = require('./config');
  console.log(chainInfo);
  
  module.exports = function registerHandlers(bot) {
      console.log('Registering handlers, bot is:', bot);

      bot.command('restart', async (ctx) => {
        await resetSessionAndShowChains(ctx);
    });

    bot.action(/^select_chain:(.+)$/, async (ctx) => {
        const chain = ctx.match[1];
        const userId = ctx.from.id; // Directly use the numeric ID

        // Ensure browsingTestnets is set appropriately
        const isBrowsingTestnets = chain === 'testnets';
    
        if (isBrowsingTestnets) {
            const testnetsDir = path.join(config.repoDir, 'testnets');
            const testnetsList = await getChainList(testnetsDir);
    
            // Store the fact that the user is looking at testnets
            updateUserLastAction(userId, {
                chain: chain, // chain here will be 'testnets'
                messageId: ctx.callbackQuery.message.message_id,
                chatId: ctx.callbackQuery.message.chat.id,
                browsingTestnets: true // Set true if browsing testnets
            });
    
            // Generate and show the keyboard for testnets
            const keyboardMarkup = paginateChains(testnetsList, 0, userId, config.pageSize);
            await ctx.reply('Select a testnet:', keyboardMarkup);
        } else {
           // Handle selecting a specific chain (not testnets)
           updateUserLastAction(userId, {
            chain: chain, // chain here is the selected chain's name
            messageId: ctx.callbackQuery.message.message_id,
            chatId: ctx.callbackQuery.message.chat.id,
            browsingTestnets: false // Set false when not browsing testnets
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
    // Check if userLastAction has an entry for the user, if not, initialize it
    if (!userLastAction.has(userId)) {
        userLastAction.set(userId, {}); // Initialize with an empty object
    }

    const userAction = userLastAction.get(userId);
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
            ctx.reply('Failed to fetch');
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
    const userAction = userLastAction.get(userId); // Using .get() for Map
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
                userLastAction.set(userId, {
                    ...userAction,
                    messageId: sentMessage.message_id,
                    chatId: sentMessage.chat.id
                }); // Updating the Map with .set()
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
    const userAction = userLastAction.get(userId);
    if (userAction && userAction.chain) {
        const peer_nodes = await chainPeerNodes(ctx, userAction.chain);

        try {
            if (userAction.messageId) {
                await ctx.telegram.editMessageText(
                    userAction.chatId,
                    userAction.messageId,
                    null,
                    peer_nodes,
                    { parse_mode: 'Markdown', disable_web_page_preview: true }
                );
            } else {
                const sentMessage = await ctx.reply(peer_nodes, { parse_mode: 'Markdown' });
                userLastAction.set(userId, {
                    ...userAction,
                    messageId: sentMessage.message_id,
                    chatId: sentMessage.chat.id
                });
            }
        } catch (error) {
            console.error('Error editing message:', error);
            // Handle error by sending new message if needed
        }
    } else {
        ctx.reply('No chain selected. Please select a chain first.');
    }
});

bot.action('block_explorers', async (ctx) => {
    const userId = ctx.from.id;
    const userAction = userLastAction.get(userId);
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
                userLastAction.set(userId, {
                    ...userAction,
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
    const userAction = userLastAction.get(userId);
    if (userAction && userAction.chain) {
        await ctx.reply(`Enter IBC denom for ${userAction.chain}:`);
    } else {
        await ctx.reply('No chain selected. Please select a chain first.');
    }
});

bot.action('pool_incentives', async (ctx) => {
    const userId = ctx.from.id;
    const userAction = userLastAction.get(userId);
    if (userAction && userAction.chain) {
        await ctx.reply(`Enter pool_id for ${userAction.chain}:`);
        expectedAction.set(userId, 'awaiting_pool_id');
    } else {
        await ctx.reply('No chain selected. Please select a chain first.');
    }
});

bot.action('price_info', async (ctx) => {
    const userId = ctx.from.id; // Convert userId to string
    const userAction = userLastAction.get(userId); // Use .get() for Map access
    if (userAction && userAction.chain === 'osmosis') {
        await ctx.reply('Enter token ticker for Price Info:');
        expectedAction.set(userId, 'awaiting_token_ticker'); // Use .set() for Map access
    } else {
        await ctx.reply('Price info is only available for Osmosis.');
    }
});

bot.action('pool_info', async (ctx) => {
    const userId = ctx.from.id; // Convert userId to string
    const userAction = userLastAction.get(userId); // Use .get() for Map access
    if (userAction && userAction.chain === 'osmosis') {
        await ctx.reply('Enter pool_id for Osmosis:');
        expectedAction.set(userId, 'awaiting_pool_id_info'); // Use .set() for Map access
    } else {
        await ctx.reply('The "Pool Info" feature is only available for the Osmosis chain.');
    }
});

}
