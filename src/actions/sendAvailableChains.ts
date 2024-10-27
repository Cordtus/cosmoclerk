import { Context } from "telegraf";
import { listAvailableChains } from "../utils/listAvailableChains";
import { logUserAction } from "../utils/logUserAction";

export async function sendAvailableChains(ctx: Context, includeTestnets: boolean = false): Promise<void> {
  const userId = ctx.from?.id;
  if (!userId) return;

  try {
    logUserAction(userId, `Requested list of available chains`);
    const chains = await listAvailableChains(includeTestnets);

    if (chains.length > 0) {
      await ctx.reply(`Available Chains:\n\n${chains.join("\n")}`);
    } else {
      await ctx.reply("No chains are currently available.");
    }
  } catch (error) {
    console.error(`[${new Date().toISOString()}] Error sending available chains to user ${userId}:`, error);
    await ctx.reply('An error occurred while fetching the list of available chains. Please try again.');
  }
}
