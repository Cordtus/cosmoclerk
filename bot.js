// bot.js

require('dotenv').config();

const { Telegraf } = require('telegraf');
console.log(process.env.BOT_TOKEN);
const bot = new Telegraf(process.env.BOT_TOKEN);
const registerHandlers = require('./handlers');
const config = require('./config');
const { cloneOrUpdateRepo } = require('./utils/repoUtils');

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

    const gracefulShutdown = async (signal) => {
        console.log(`Received ${signal}. Gracefully shutting down...`);
        await bot.stop();
        console.log("Bot has been stopped.");
        process.exit(0);
    };

    // Capture termination or interrupt signals
    process.on('SIGINT', () => gracefulShutdown('SIGINT'));
    process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
})();
