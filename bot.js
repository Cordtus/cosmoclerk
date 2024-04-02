// bot.js

require('dotenv').config();
const { Telegraf } = require('telegraf');
const bot = new Telegraf(process.env.BOT_TOKEN);
const registerHandlers = require('./handlers');
const { periodicUpdateRepo } = require('./utils'); // Importing from utils/index.js now
const config = require('./config');

// First, update the repository if necessary
(async () => {
    await periodicUpdateRepo(); // Using function directly as it's exported from utils/index.js
})();

// Then, register handlers and launch the bot
registerHandlers(bot);

bot.launch()
    .then(() => console.log('Bot is alive!'))
    .catch(error => console.error('Failed to launch bot:', error));

process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
