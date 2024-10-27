import { Context } from "telegraf";
import { logUserAction } from "../utils/logUserAction";

export async function sendHelpInfo(ctx: Context): Promise<void> {
  const userId = ctx.from?.id;
  if (!userId) return;

  try {
    logUserAction(userId, `Requested help information`);

    const helpMessage = `
    Here are the commands you can use:
    /start - Start the bot and reset your session.
    /restart - Restart your current interaction and clear previous data.
    /help - Show this help message.
    /lookup [chain] - Get detailed information about a specific chain.
    /testnet [chain] - Get information about a specific testnet chain.
    /validators [chain] - Get a list of validators for a given chain.
    /governance [chain] - Get governance details for a given chain.
    /network [rpc_url] - Get the network status from the provided RPC URL.

    Use inline buttons where available to navigate options.
    `;
    
    await ctx.reply(helpMessage);
  } catch (error) {
    console.error(`[${new Date().toISOString()}] Error sending help information:`, error);
    await ctx.reply('An error occurred while fetching help information. Please try again.');
  }
}
