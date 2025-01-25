import { Context } from 'telegraf';

import { validateUserInput } from '../botUtils/validateUserInput';
import { logUserAction } from '../botUtils/logUserAction';
import { sendChainDetails } from './sendChainDetails';

export async function handleCustomCommand(
  ctx: Context,
  command: string,
  parameter: string,
): Promise<void> {
  const userId = ctx.from?.id;
  if (!userId) {
    return;
  }

  try {
    if (!validateUserInput(parameter)) {
      await ctx.reply(
        'Invalid input. Please make sure to use valid characters.',
      );
      return;
    }

    logUserAction(
      userId,
      `Executed custom command: ${command} with parameter: ${parameter}`,
    );

    if (command === 'lookup') {
      await sendChainDetails(ctx, parameter);
    } else {
      await ctx.reply(`Unknown command: ${command}`);
    }
  } catch (error) {
    console.error(
      `[${new Date().toISOString()}] Error handling custom command: ${command} with parameter: ${parameter}`,
      error,
    );
    await ctx.reply(
      'An error occurred while executing the command. Please try again.',
    );
  }
}
