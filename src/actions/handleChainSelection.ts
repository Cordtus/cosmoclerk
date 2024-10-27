import { Context } from "telegraf";
import { updateUserLastAction } from "../sessionManager/userSessions";
import { getChainInfo } from "../utils/getChainInfo";

export async function handleChainSelection(ctx: Context, chain: string): Promise<void> {
  const userId = ctx.from?.id;
  if (!userId) return;

  try {
    const chainInfo = await getChainInfo(chain);
    if (chainInfo) {
      const chainDetails = `Chain Name: ${chainInfo.name}\nRPC Endpoint: ${chainInfo.rpc}\nExplorer: ${chainInfo.explorer}`;
      await ctx.reply(chainDetails);
    } else {
      await ctx.reply('Chain information could not be found.');
    }
    updateUserLastAction(userId, { chain });
  } catch (error) {
    console.error(`[${new Date().toISOString()}] Error handling chain selection for ${chain}:`, error);
    await ctx.reply('An error occurred while fetching the chain details.');
  }
}
