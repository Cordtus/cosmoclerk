require('dotenv').config();
const { Telegraf } = require('telegraf');
const config = require('./config');
const { registerHandlers } = require('./handlers');
const sessionUtils = require('./utils/sessionUtils');

const bot = new Telegraf(process.env.BOT_TOKEN);

// Register handlers
registerHandlers(bot);

// Launch the bot
bot.launch();

bot.start((ctx) => {
    const userId = ctx.from.id.toString();
    sessionUtils.updateUserLastAction(userId, { action: 'start' });
    ctx.reply('Welcome! Use /menu to get started.');
});

// Handle graceful shutdown
process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
