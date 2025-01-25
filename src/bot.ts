import { Telegraf } from 'telegraf';
import { config } from 'dotenv';

import { cloneOrUpdateRepo } from './repoManager/cloneOrUpdateRepo';
import { setupCommands } from './commands/setupCommands';
import { setupActions } from './actions/setupActions';

// Load environment variables from .env
config();

// Initialize the bot with the token from environment variables
const BOT_TOKEN = process.env.BOT_TOKEN;

if (!BOT_TOKEN) {
  throw new Error('BOT_TOKEN must be provided in environment variables');
}

const bot = new Telegraf(BOT_TOKEN);

// Set up the repo clone/update initially
cloneOrUpdateRepo();

setupCommands(bot);

setupActions(bot);

// Launch the bot
bot
  .launch()
  .then(() => console.log('Bot launched successfully'))
  .catch((error) => console.error('Failed to launch the bot:', error));

// Graceful stop
process.once('SIGINT', () => {
  console.log('SIGINT signal received. Shutting down gracefully.');
  bot.stop('SIGINT received');
  process.exit(0);
});

process.once('SIGTERM', () => {
  console.log('SIGTERM signal received. Shutting down gracefully.');
  bot.stop('SIGTERM received');
  process.exit(0);
});
