// bot.js

const { Telegraf } = require('telegraf');
const config = require('./config');
const registerHandlers = require('./handlers'); // Correct path to handlers.js
const { periodicUpdateRepo } = require('./utils/repoUtils');

const bot = new Telegraf(config.BOT_TOKEN);

(async () => {
    await periodicUpdateRepo(config.repoDir, config.repoUrl, config.staleHours);
    registerHandlers(bot); // This should now work as expected
})();

bot.launch()
    .then(() => console.log('Bot launched successfully'))
    .catch(error => console.error('Failed to launch the bot:', error));

process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
