import { Context } from "telegraf";
import { getUserLastAction, updateUserLastAction } from "../sessionManager/userSessions";
import { logUserAction } from "../utils/logUserAction";

export async function removeUserChain(ctx: Context, chain: string): Promise<void> {
  const userId = ctx.from?.id;
  if (!userId) return;

  try {
    logUserAction(userId, `Requested to remove chain: ${chain}`);
    const userAction = getUserLastAction(userId);

    if (userAction && userAction.customData && Array.isArray(userAction.customData.preferredChains)) {
      const updatedChains = userAction.customData.preferredChains.filter((c: string) => c !== chain);
      updateUserLastAction(userId, { ...userAction, customData: { preferredChains: updatedChains } });

      await ctx.reply(`Chain "${chain}" has been removed from your list.`);
    } else {
      await ctx.reply(`You have no preferred chains or chain "${chain}" could not be found in your list.`);
    }
  } catch (error) {
    console.error(`[${new Date().toISOString()}] Error removing chain ${chain} for user ${userId}:`, error);
    await ctx.reply('An error occurred while trying to remove the chain. Please try again.');
  }
}
