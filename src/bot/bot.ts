import { Telegraf } from 'telegraf';
import { BotContext } from '../types';
import { FileSystemManager } from '../utils/fileSystem';
import { EndpointManager } from '../utils/endpointManager';
import { BotActions } from './actions';
import config from '../config/config';

export function setupBot(fileSystemManager: FileSystemManager, endpointManager: EndpointManager): Telegraf<BotContext> {
  const bot = new Telegraf<BotContext>(config.BOT_TOKEN);
  const actions = new BotActions(fileSystemManager, endpointManager);

  bot.command('start', ctx => actions.handleStart(ctx));
  bot.command('chaininfo', ctx => actions.handleChainInfo(ctx));
  // Add other command handlers here

  return bot;
}