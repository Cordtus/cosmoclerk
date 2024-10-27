import { Context } from "telegraf";
import { resetUserSession } from "../sessionManager/userSessions";
import { getChainList } from "../utils/getChainList";
import { paginateChains } from "../utils/paginateChains";

export async function resetSessionAndShowChains(ctx: Context): Promise<void> {
  const userId = ctx.from?.id;
  if (!userId) return;

  try {
    console.log(`[${new Date().toISOString()}] Restarting session for user: ${userId}`);
    resetUserSession(userId);

    // Fetch the updated chain list
    const chains = await getChainList();
    const keyboard = paginateChains(chains, 0, userId, 18);

    await ctx.reply('Session restarted. Please select a chain:', keyboard);
  } catch (error) {
    console.error(`[${new Date().toISOString()}] Error resetting session for user ${userId}:`, error);
    await ctx.reply('An error occurred while resetting your session. Please try again.');
  }
}
