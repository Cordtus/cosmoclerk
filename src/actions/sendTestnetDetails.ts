import { Context } from "telegraf";
import { getTestnetChainInfo } from "../utils/getTestnetChainInfo";
import { logUserAction } from "../utils/logUserAction";

export async function sendTestnetDetails(ctx: Context, chain: string): Promise<void> {
  const userId = ctx.from?.id;
  if (!userId) return;

  try {
    logUserAction(userId, `Requested testnet details for chain: ${chain}`);

    const testnetDetails = await getTestnetChainInfo(chain);
    if (testnetDetails) {
      const message = `Testnet Details for ${chain}:\n\nRPC Endpoint: ${testnetDetails.rpc}\nExplorer: ${testnetDetails.explorer}`;
      await ctx.reply(message);
    } else {
      await ctx.reply(`Testnet details could not be found for ${chain}.`);
    }
  } catch (error) {
    console.error(`[${new Date().toISOString()}] Error sending testnet details for ${chain}:`, error);
    await ctx.reply('An error occurred while fetching testnet details. Please try again.');
  }
}
