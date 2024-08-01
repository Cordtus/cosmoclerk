import { bot } from './bot/bot';
import config from './config/config';
import { setupFileSystemManager } from './utils/fileSystem';
import { setupEndpointManager } from './utils/endpointManager';

async function main() {
  const fileSystemManager = setupFileSystemManager(config);
  const endpointManager = await setupEndpointManager(fileSystemManager);

  bot.launch()
    .then(() => console.log('Bot launched successfully'))
    .catch(error => console.error('Failed to launch the bot:', error));

  // Enable graceful stop
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
}

main().catch(console.error);