import { Context } from 'telegraf';

import { getChainPeers } from '../botUtils/getChainPeers';
import { logUserAction } from '../botUtils/logUserAction';

export async function sendChainPeers(
  ctx: Context,
  chain: string,
): Promise<void> {
  const userId = ctx.from?.id;
  if (!userId) {
    return;
  }

  try {
    logUserAction(userId, `Requested peers for chain: ${chain}`);

    const peers = await getChainPeers(chain);
    const peerText = peers.length
      ? peers.join('\n')
      : 'No peers found for this chain.';

    const message = `Peers for ${chain}:\n\n${peerText}`;
    await ctx.reply(message);
  } catch (error) {
    console.error(
      `[${new Date().toISOString()}] Error sending peers for ${chain}:`,
      error,
    );
    await ctx.reply(
      'An error occurred while fetching peers. Please try again.',
    );
  }
}
