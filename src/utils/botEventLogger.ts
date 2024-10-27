import { Context } from "telegraf";

export function logBotEvent(ctx: Context, eventDescription: string): void {
  const userId = ctx.from?.id;
  const userName = ctx.from?.username || "unknown";
  console.log(`[${new Date().toISOString()}] User: ${userName} (ID: ${userId}) - ${eventDescription}`);
}

export function handleBotError(ctx: Context, error: any, actionDescription: string): void {
  const userId = ctx.from?.id;
  console.error(`[${new Date().toISOString()}] Error during ${actionDescription} for user ID ${userId}:`, error);
  ctx.reply('An unexpected error occurred. Please try again.');
}
