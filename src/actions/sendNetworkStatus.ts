import { Context } from 'telegraf';

import { getNetworkStatus } from '../chainUtils/getNetworkStatus';
import { logUserAction } from '../botUtils/logUserAction';

export async function sendNetworkStatus(
  ctx: Context,
  rpcUrl: string,
): Promise<void> {
  const userId = ctx.from?.id;
  if (!userId) {
    return;
  }

  try {
    logUserAction(userId, `Requested network status for RPC: ${rpcUrl}`);

    const networkStatus = await getNetworkStatus(rpcUrl);
    if (networkStatus) {
      const message = `Network Status:\n\nLatest Block Height: ${networkStatus.latestBlockHeight}\nLatest Block Time: ${networkStatus.latestBlockTime}\nCatching Up: ${networkStatus.catchingUp ? 'Yes' : 'No'}`;
      await ctx.reply(message);
    } else {
      await ctx.reply('Unable to retrieve network status.');
    }
  } catch (error) {
    console.error(
      `[${new Date().toISOString()}] Error sending network status for RPC ${rpcUrl}:`,
      error,
    );
    await ctx.reply(
      'An error occurred while fetching network status. Please try again.',
    );
  }
}
