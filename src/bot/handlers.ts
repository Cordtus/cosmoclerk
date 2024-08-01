import { Telegraf, Context } from 'telegraf';
import { BotContext } from '../types';
import {
  handleStart,
  handleRestart,
  handleChainInfo,
  handleEndpoints,
  handlePeerNodes,
  handleBlockExplorers,
  handlePoolIncentives,
  handlePoolInfo,
  handlePriceInfo,
  handleIbcDenom,
  handleMainMenuAction,
  handlePageNavigation,
  handleChainSelection,
  handleTestnets,
  editOrSendMessage,
  resetSessionAndShowChains
} from './actions';

export function setupCommandHandlers(bot: Telegraf<BotContext>) {
  // Command handlers
  bot.command('start', handleStart);
  bot.command('restart', handleRestart);

  // Action handlers
  bot.action('chain_info', handleChainInfo);
  bot.action('endpoints', handleEndpoints);
  bot.action('peer_nodes', handlePeerNodes);
  bot.action('block_explorers', handleBlockExplorers);
  bot.action('ibc_id', handleIbcDenom);
  bot.action('pool_incentives', ctx => handlePoolIncentives(ctx, 'awaiting_pool_id'));
  bot.action('pool_info', ctx => handlePoolInfo(ctx, 'awaiting_pool_id_info'));
  bot.action('price_info', ctx => handlePriceInfo(ctx, 'awaiting_token_ticker'));

  // Chain selection handler
  bot.action(/^select_chain:(.+)$/, handleChainSelection);

  // Pagination handler
  bot.action(/page:(\d+)/, handlePageNavigation);

  // Text input handler
  bot.on('text', async (ctx) => {
    const text = ctx.message.text.trim().toLowerCase();
    const userId = ctx.from.id;

    if (text === '/start' || text === '/restart') {
      await resetSessionAndShowChains(ctx);
    } else if (ctx.session.expectedAction === 'awaiting_token_ticker') {
      await handlePriceInfo(ctx, text);
    } else if (ctx.session.expectedAction === 'awaiting_pool_id') {
      const poolId = parseInt(text, 10);
      if (isNaN(poolId)) {
        await ctx.reply('Please enter a valid pool_id.');
      } else {
        await handlePoolIncentives(ctx, poolId);
      }
    } else if (ctx.session.expectedAction === 'awaiting_pool_id_info') {
      const poolId = parseInt(text, 10);
      if (isNaN(poolId)) {
        await ctx.reply('Please enter a valid pool_id for Pool Info.');
      } else {
        await handlePoolInfo(ctx, poolId);
      }
    } else if (text.startsWith('ibc/')) {
      await handleIbcDenom(ctx, text.slice(4));
    } else if (!isNaN(parseInt(text))) {
      const optionIndex = parseInt(text) - 1;
      const mainMenuOptions = ['chain_info', 'peer_nodes', 'endpoints', 'block_explorers', 'ibc_id', 'pool_incentives', 'pool_info', 'price_info'];
      if (optionIndex >= 0 && optionIndex < mainMenuOptions.length) {
        await handleMainMenuAction(ctx, mainMenuOptions[optionIndex], ctx.session.userAction.chain);
      } else {
        await ctx.reply('Invalid option number. Please try again.');
      }
    } else {
      await handleChainSelection(ctx, text);
    }
  });

  // Error handler
  bot.catch((err: any, ctx: Context) => {
    console.error(`Error for ${ctx.updateType}`, err);
    ctx.reply('An error occurred while processing your request. Please try again.');
  });
}