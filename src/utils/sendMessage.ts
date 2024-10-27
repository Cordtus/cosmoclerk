import { Context } from "telegraf";

export async function sendMessage(ctx: Context, text: string): Promise<void> {
  try {
    await ctx.reply(text);
  } catch (error) {
    console.error(`[${new Date().toISOString()}] Error sending message:`, error);
  }
}
