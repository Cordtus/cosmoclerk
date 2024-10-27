import { Context } from "telegraf";
import { getUserLastAction, resetUserSession } from "./userSessions";

const SESSION_TIMEOUT = 15 * 60 * 1000; // 15 minutes timeout

export function checkAndHandleSessionExpiration(ctx: Context): boolean {
  const userId = ctx.from?.id;
  if (!userId) {
    console.error(`[${new Date().toISOString()}] Error: Unable to retrieve user ID from context.`);
    return false;
  }

  const userAction = getUserLastAction(userId);
  if (userAction) {
    const lastInteractionTime = userAction.timestamp;
    if (lastInteractionTime && new Date().getTime() - lastInteractionTime.getTime() > SESSION_TIMEOUT) {
      resetUserSession(userId);
      ctx.reply("Your session has expired due to inactivity. Please start a new session by using /start.");
      return true;
    }
  }

  return false;
}
