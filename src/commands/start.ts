import { Context } from "telegraf";
import { getChainList } from "../chainUtils/getChainList";
import { paginateChains } from "../botUtils/paginateChains";
import { resetUserSession } from "../sessionManager/userSessions";

const pageSize = 18;

export async function startInteraction(ctx: Context): Promise<void> {
  const userId = ctx.from?.id;
  if (!userId) return;

  console.log(`[${new Date().toISOString()}] User ${userId} started interaction.`);

  // Reset the user's session on /start command
  resetUserSession(userId);

  // Retrieve the chain list and generate paginated chain list
  const chains = await getChainList();
  const keyboard = paginateChains(chains, 0, userId, pageSize);
  await ctx.reply('Type a chain name, or select from the menu:', keyboard);
}
