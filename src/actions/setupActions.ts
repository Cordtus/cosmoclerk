import { Telegraf, Context } from 'telegraf';

import { handleInlineButtonPress } from './handleInlineButtonPress';
import { handlePointerLookup } from './handlePointerLookup';
import { handleUnknownCommand } from './handleUnknownCommand';
import { handleChainSelection } from './handleChainSelection';
import { handleChainAction } from './handleChainAction';
import { listUserChains } from './listUserChains';
import { addUserChain } from './addUserChain';
import { removeUserChain } from './removeUserChain';

export function setupActions(bot: Telegraf<Context>): void {
  // Inline Button Press Handler
  bot.on('callback_query', async (ctx) => {
    try {
      await handleInlineButtonPress(ctx);
    } catch (error) {
      console.error(
        `[${new Date().toISOString()}] Error in callback query:`,
        error,
      );
    }
  });

  // Pointer Lookup Handler
  bot.command('lookup', async (ctx) => {
    const input = ctx.message?.text?.split(' ')[1];
    if (input) {
      await handlePointerLookup(ctx, input);
    } else {
      await ctx.reply('Please provide a valid input for lookup.');
    }
  });

  // Chain Selection Handler
  bot.command('selectchain', async (ctx) => {
    const chain = ctx.message?.text?.split(' ')[1];
    if (chain) {
      await handleChainSelection(ctx, chain);
    } else {
      await ctx.reply('Please provide a valid chain name to select.');
    }
  });

  // Chain Action Handler
  bot.command('chainaction', async (ctx) => {
    const args = ctx.message?.text?.split(' ');
    if (args && args.length > 2) {
      const chain = args[1];
      const actionType = args[2]; // Assuming this is the missing third argument
      await handleChainAction(ctx, chain, actionType);
    } else {
      await ctx.reply(
        'Please provide a valid chain name and action type for the action.',
      );
    }
  });

  // List User Chains Handler
  bot.command('mychains', async (ctx) => {
    try {
      await listUserChains(ctx);
    } catch (error) {
      console.error(
        `[${new Date().toISOString()}] Error listing user chains:`,
        error,
      );
    }
  });

  // Add User Chain Handler
  bot.command('addchain', async (ctx) => {
    const chain = ctx.message?.text?.split(' ')[1];
    if (chain) {
      await addUserChain(ctx, chain);
    } else {
      await ctx.reply('Please specify the chain name you want to add.');
    }
  });

  // Remove User Chain Handler
  bot.command('removechain', async (ctx) => {
    const chain = ctx.message?.text?.split(' ')[1];
    if (chain) {
      await removeUserChain(ctx, chain);
    } else {
      await ctx.reply('Please specify the chain name you want to remove.');
    }
  });

  // Unknown Command Handler (Fallback)
  bot.on('text', async (ctx) => {
    await handleUnknownCommand(ctx);
  });
}
