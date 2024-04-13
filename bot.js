// bot.js

require('dotenv').config();
const { Telegraf } = require('telegraf');
const bot = new Telegraf(process.env.BOT_TOKEN);
const registerHandlers = require('./handlers');
const config = require('./config'); // Direct import of configuration settings
const { cloneOrUpdateRepo } = require('./utils/repoUtils'); // Directly import from the source

(async () => {
    try {
        await cloneOrUpdateRepo();
    } catch (error) {
        console.error('Failed to update repository data on bot startup:', error);
        process.exit(1);
    }

    registerHandlers(bot);

    bot.launch()
        .then(() => console.log('Bot is alive!'))
        .catch(error => console.error('Failed to launch bot:', error));

    process.once('SIGINT', () => bot.stop('SIGINT'));
    process.once('SIGTERM', () => bot.stop('SIGTERM'));
})();
