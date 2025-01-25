import { Context } from 'telegraf';

import { handleChainSelection } from './handleChainSelection';
import { handleMenuSelection } from '../botUtils/handleMenuSelection';

export async function handleInlineButtonPress(ctx: Context): Promise<void> {
  try {
    // Use type assertion to indicate that callbackQuery is of type 'CallbackQuery.DataCallbackQuery'
    const callbackQuery = ctx.callbackQuery;

    if (callbackQuery && 'data' in callbackQuery) {
      const data = callbackQuery.data;

      if (typeof data === 'string') {
        if (data.startsWith('select_chain:')) {
          const chain = data.split(':')[1];
          await handleChainSelection(ctx, chain);
        } else if (data.startsWith('page:')) {
          const page = parseInt(data.split(':')[1], 10);
          await handleMenuSelection(ctx, page);
        }
      }

      // Acknowledge the button press
      await ctx.answerCbQuery();
    }
  } catch (error) {
    console.error(
      `[${new Date().toISOString()}] Error handling inline button press:`,
      error,
    );
    // Provide an alert to the user indicating an error occurred
    await ctx.answerCbQuery('An error occurred. Please try again.', {
      show_alert: true,
    });
  }
}
