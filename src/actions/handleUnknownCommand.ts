import { Context } from "telegraf";

export async function handleUnknownCommand(ctx: Context): Promise<void> {
  try {
    await ctx.reply("Sorry, I didn't understand that command. Please try again or use /start to restart.");
  } catch (error) {
    console.error(`[${new Date().toISOString()}] Error handling unknown command:`, error);
  }
}
