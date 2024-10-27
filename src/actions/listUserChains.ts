import { Context } from "telegraf";
import { getUserLastAction } from "../sessionManager/userSessions";
import { logUserAction } from "../botUtils/logUserAction";
import { getCachedUserPreferences, cacheUserPreferences } from "../botUtils/cacheUserPreferences";

export async function listUserChains(ctx: Context): Promise<void> {
  const userId = ctx.from?.id;
  if (!userId) return;

  try {
    logUserAction(userId, `Requested to list preferred chains`);

    // Check cache first
    const cachedPreferences = getCachedUserPreferences(userId);
    if (cachedPreferences) {
      await ctx.reply(`Your preferred chains (from cache):\n\n${cachedPreferences.preferredChains.join("\n")}`);
      return;
    }

    // Otherwise, get from session
    const userAction = getUserLastAction(userId);
    if (userAction && userAction.customData && Array.isArray(userAction.customData.preferredChains)) {
      const preferredChains = userAction.customData.preferredChains;
      if (preferredChains.length > 0) {
        // Cache the preferences
        cacheUserPreferences(userId, preferredChains);
        await ctx.reply(`Your preferred chains:\n\n${preferredChains.join("\n")}`);
      } else {
        await ctx.reply('You have not added any preferred chains.');
      }
    } else {
      await ctx.reply('You have not added any preferred chains.');
    }
  } catch (error) {
    console.error(`[${new Date().toISOString()}] Error listing preferred chains for user ${userId}:`, error);
    await ctx.reply('An error occurred while trying to list your preferred chains. Please try again.');
  }
}
