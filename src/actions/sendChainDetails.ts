import { Context } from "telegraf";
import { getChainRpcEndpoints } from "../utils/getChainRpcEndpoints";
import { getChainExplorers } from "../utils/getChainExplorers";
import { logUserAction } from "../utils/logUserAction";

export async function sendChainDetails(ctx: Context, chain: string): Promise<void> {
  const userId = ctx.from?.id;
  if (!userId) return;

  try {
    logUserAction(userId, `Requested details for chain: ${chain}`);
    
    const rpcEndpoints = await getChainRpcEndpoints(chain);
    const explorers = await getChainExplorers(chain);

    const rpcText = rpcEndpoints.length ? rpcEndpoints.join("\n") : "No RPC endpoints found.";
    const explorersText = explorers.length ? explorers.join("\n") : "No explorers found.";

    const message = `Details for ${chain}:\n\nRPC Endpoints:\n${rpcText}\n\nExplorers:\n${explorersText}`;
    await ctx.reply(message);
  } catch (error) {
    console.error(`[${new Date().toISOString()}] Error sending chain details for ${chain}:`, error);
    await ctx.reply('An error occurred while fetching chain details. Please try again.');
  }
}
