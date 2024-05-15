require('dotenv').config();
const { Telegraf } = require('telegraf');
const config = require('./config');
const { registerHandlers } = require('./handlers');
const repoUtils = require('./utils/repoUtils');
const sessionUtils = require('./utils/sessionUtils');
const menuFuncs = require('./funcs/menuFuncs');
const chainFuncs = require('./funcs/chainFuncs');

const bot = new Telegraf(process.env.BOT_TOKEN);

// Register handlers
registerHandlers(bot);

// Launch the bot
bot.launch()
    .then(() => console.log('Bot started'))
    .catch(err => console.error('Failed to start bot:', err));

bot.start(async (ctx) => {
    const userId = ctx.from.id.toString();
    sessionUtils.updateUserLastAction(userId, { action: 'start' });

    // Check if the repo data is stale and refresh if necessary
    await repoUtils.cloneOrUpdateRepo();

    // Generate the list of chains
    const chains = await repoUtils.getChainList();
    const keyboardMarkup = menuFuncs.paginateChains(chains, 0, userId, config.pageSize);
    await ctx.reply('Please select a chain:', keyboardMarkup);
});

// Handle graceful shutdown
process.once('SIGINT', () => {
    console.log('SIGINT received, stopping bot...');
    bot.stop('SIGINT');
});
process.once('SIGTERM', () => {
    console.log('SIGTERM received, stopping bot...');
    bot.stop('SIGTERM');
});
