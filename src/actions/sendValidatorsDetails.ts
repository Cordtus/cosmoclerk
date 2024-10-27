import { Context } from "telegraf";
import { getValidatorsList } from "../utils/getValidatorsList";
import { logUserAction } from "../utils/logUserAction";

export async function sendValidatorsDetails(ctx: Context, chain: string): Promise<void> {
  const userId = ctx.from?.id;
  if (!userId) return;

  try {
    logUserAction(userId, `Requested validators for chain: ${chain}`);
    const validators = await getValidatorsList(chain);

    if (validators.length > 0) {
      const validatorDetails = validators
        .map((validator: any) => `Validator: ${validator.name}\nPower: ${validator.votingPower}\nAddress: ${validator.address}\n`)
        .join("\n");
      await ctx.reply(`Validators for ${chain}:\n\n${validatorDetails}`);
    } else {
      await ctx.reply(`No validators found for ${chain}.`);
    }
  } catch (error) {
    console.error(`[${new Date().toISOString()}] Error sending validators for ${chain}:`, error);
    await ctx.reply('An error occurred while fetching validator details. Please try again.');
  }
}
