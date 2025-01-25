import { Telegraf } from 'telegraf';

import { startInteraction } from './start';
import { resetSessionAndShowChains } from './restart';
import { sendHelpInfo } from '../actions/sendHelpInfo';
import { handleCustomCommand } from '../actions/handleCustomCommand';
import { sendValidatorsDetails } from '../actions/sendValidatorsDetails';
import { sendGovernanceDetails } from '../actions/sendGovernanceDetails';
import { sendTestnetDetails } from '../actions/sendTestnetDetails';
import { sendNetworkStatus } from '../actions/sendNetworkStatus';
import { listUserChains } from '../actions/listUserChains';
import { addUserChain } from '../actions/addUserChain';
import { removeUserChain } from '../actions/removeUserChain';
import { sendAvailableChains } from '../actions/sendAvailableChains';
import {
  getUserSettings,
  updateUserSettings,
} from '../sessionManager/settingsManager';

export function setupCommands(bot: Telegraf): void {
  bot.command('start', (ctx) => startInteraction(ctx));
  bot.command('restart', (ctx) => resetSessionAndShowChains(ctx));
  bot.command('help', (ctx) => sendHelpInfo(ctx));

  bot.command('lookup', (ctx) => {
    const parameter = ctx.message?.text?.split(' ')[1];
    if (parameter) {
      handleCustomCommand(ctx, 'lookup', parameter);
    } else {
      ctx.reply(
        'Please provide a chain name to lookup. Example: /lookup cosmos',
      );
    }
  });

  bot.command('testnet', (ctx) => {
    const parameter = ctx.message?.text?.split(' ')[1];
    if (parameter) {
      sendTestnetDetails(ctx, parameter);
    } else {
      ctx.reply(
        'Please provide a testnet chain name. Example: /testnet cosmos-testnet',
      );
    }
  });

  bot.command('validators', (ctx) => {
    const parameter = ctx.message?.text?.split(' ')[1];
    if (parameter) {
      sendValidatorsDetails(ctx, parameter);
    } else {
      ctx.reply(
        'Please provide a chain name to get validators. Example: /validators cosmos',
      );
    }
  });

  bot.command('governance', (ctx) => {
    const parameter = ctx.message?.text?.split(' ')[1];
    if (parameter) {
      sendGovernanceDetails(ctx, parameter);
    } else {
      ctx.reply(
        'Please provide a chain name to get governance details. Example: /governance cosmos',
      );
    }
  });

  bot.command('network', (ctx) => {
    const parameter = ctx.message?.text?.split(' ')[1];
    if (parameter) {
      sendNetworkStatus(ctx, parameter);
    } else {
      ctx.reply(
        'Please provide an RPC URL to get network status. Example: /network https://rpc.cosmos.network',
      );
    }
  });

  bot.command('addchain', (ctx) => {
    const parameter = ctx.message?.text?.split(' ')[1];
    if (parameter) {
      addUserChain(ctx, parameter);
    } else {
      ctx.reply(
        'Please provide a chain name to add to your list. Example: /addchain cosmos',
      );
    }
  });

  bot.command('removechain', (ctx) => {
    const parameter = ctx.message?.text?.split(' ')[1];
    if (parameter) {
      removeUserChain(ctx, parameter);
    } else {
      ctx.reply(
        'Please provide a chain name to remove from your list. Example: /removechain cosmos',
      );
    }
  });

  bot.command('mychains', (ctx) => {
    listUserChains(ctx);
  });

  bot.command('chains', (ctx) => {
    sendAvailableChains(ctx);
  });

  bot.command('testnets', (ctx) => {
    sendAvailableChains(ctx, true);
  });

  bot.command('settings', async (ctx) => {
    const userId = ctx.from?.id;
    if (!userId) {
      return;
    }

    const settings = getUserSettings(userId);
    await ctx.reply(
      `Your current settings:\n\nNotifications: ${settings.notifications ? 'On' : 'Off'}\nDefault Chain: ${settings.defaultChain || 'None'}`,
    );
  });

  bot.command('setnotifications', async (ctx) => {
    const parameter = ctx.message?.text?.split(' ')[1];
    const userId = ctx.from?.id;
    if (!userId) {
      return;
    }

    if (parameter === 'on' || parameter === 'off') {
      const currentSettings = getUserSettings(userId);
      updateUserSettings(userId, {
        ...currentSettings,
        notifications: parameter === 'on',
      });
      await ctx.reply(`Notifications have been turned ${parameter}.`);
    } else {
      await ctx.reply(
        "Please specify 'on' or 'off'. Example: /setnotifications on",
      );
    }
  });
}

export * from './setupCommands';
