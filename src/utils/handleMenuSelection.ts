import { Context } from "telegraf";
import { getUserLastAction, updateUserLastAction } from "../sessionManager/userSessions";
import { getChainList } from "../utils/getChainList";
import { paginateChains } from "../utils/paginateChains";

const pageSize = 18;

export async function handleMenuSelection(ctx: Context, currentPage: number): Promise<void> {
  const userId = ctx.from?.id;
  if (!userId) return;

  const userAction = getUserLastAction(userId);
  if (!userAction) {
    await ctx.reply('Session expired. Please restart with /start.'); // Change here: `await` instead of `return`
    return;
  }

  // Retrieve chains for pagination
  const chains = await getChainList();
  const keyboard = paginateChains(chains, currentPage, userId, pageSize);

  await ctx.editMessageReplyMarkup(keyboard.reply_markup);
}
