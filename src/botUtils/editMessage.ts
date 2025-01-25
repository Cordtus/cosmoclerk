import { Context } from 'telegraf';

export async function editMessage(
  ctx: Context,
  messageId: number,
  newText: string,
): Promise<void> {
  try {
    await ctx.telegram.editMessageText(
      ctx.chat?.id,
      messageId,
      undefined,
      newText,
    );
  } catch (error) {
    console.error(
      `[${new Date().toISOString()}] Error editing message ID ${messageId}:`,
      error,
    );
  }
}
