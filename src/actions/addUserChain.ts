import { Context } from "telegraf";
import { getUserLastAction, updateUserLastAction } from "../sessionManager/userSessions";
import { logUserAction } from "../utils/logUserAction";

export async function addUserChain(ctx: Context, chain: string): Promise<void> {
  const userId = ctx.from?.id;
  if (!userId) return;

  try {
    logUserAction(userId, `Requested to add chain: ${chain}`);
    const userAction = getUserLastAction(userId);

    if (userAction) {
      const preferredChains = userAction.customData?.preferredChains || [];
      if (!preferredChains.includes(chain)) {
        preferredChains.push(chain);
        updateUserLastAction(userId, { ...userAction, customData: { preferredChains } });
        await ctx.reply(`Chain "${chain}" has been added to your list.`);
      } else {
        await ctx.reply(`Chain "${chain}" is already in your list.`);
      }
    } else {
      updateUserLastAction(userId, { customData: { preferredChains: [chain] } });
      await ctx.reply(`Chain "${chain}" has been added to your list.`);
    }
  } catch (error) {
    console.error(`[${new Date().toISOString()}] Error adding chain ${chain} for user ${userId}:`, error);
    await ctx.reply('An error occurred while trying to add the chain. Please try again.');
  }
}
