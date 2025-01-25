import { Context } from 'telegraf';

import { getChainGovernanceDetails } from '../chainUtils/getChainGovernanceDetails';
import { logUserAction } from '../botUtils/logUserAction';

export async function sendGovernanceDetails(
  ctx: Context,
  chain: string,
): Promise<void> {
  const userId = ctx.from?.id;
  if (!userId) {
    return;
  }

  try {
    logUserAction(userId, `Requested governance details for chain: ${chain}`);

    const governanceDetails = await getChainGovernanceDetails(chain);
    if (governanceDetails.proposals.length > 0) {
      const proposals = governanceDetails.proposals
        .map((proposal: any) => `Proposal #${proposal.id}: ${proposal.title}`)
        .join('\n');
      await ctx.reply(`Governance Proposals for ${chain}:\n\n${proposals}`);
    } else {
      await ctx.reply(`No governance proposals available for ${chain}.`);
    }

    await ctx.reply(`Staking Information: ${governanceDetails.staking}`);
  } catch (error) {
    console.error(
      `[${new Date().toISOString()}] Error sending governance details for ${chain}:`,
      error,
    );
    await ctx.reply(
      'An error occurred while fetching governance details. Please try again.',
    );
  }
}
