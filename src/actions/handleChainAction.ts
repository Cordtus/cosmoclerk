import { Context } from "telegraf";
import { sendChainDetails } from "./sendChainDetails";
import { updateUserLastAction } from "../sessionManager/userSessions";

export async function handleChainAction(ctx: Context, chain: string, actionType: string): Promise<void> {
  const userId = ctx.from?.id;
  if (!userId) return;

  try {
    if (actionType === "details") {
      await sendChainDetails(ctx, chain);
    } else {
      await ctx.reply(`Unknown action type: ${actionType}`);
    }

    // Update the user's last action with the selected chain
    updateUserLastAction(userId, { chain });
  } catch (error) {
    console.error(`[${new Date().toISOString()}] Error handling action for chain ${chain}:`, error);
    await ctx.reply('An error occurred while performing the chain action.');
  }
}
