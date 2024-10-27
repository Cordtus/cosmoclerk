import { Context } from "telegraf";
import { queryPointer } from "../utils/queryPointer";

export async function handlePointerLookup(ctx: Context, input: string): Promise<void> {
  try {
    // Determine the type of input and act accordingly.
    if (isValidEthereumAddress(input)) {
      // Handle as an Ethereum address
      await ctx.reply(`You provided an Ethereum address: ${input}`);
      // You could include functionality like looking up this address in a block explorer or another service.
    } else if (isTokenDenomination(input)) {
      // Handle as a token denomination
      await ctx.reply(`You provided a token denomination: ${input}`);
      // Add appropriate logic here if you need to perform operations with this token denomination.
    } else {
      // If input doesn't match common patterns, treat it as a chain for querying pointer info.
      const pointerInfo = await queryPointer(input);

      if (pointerInfo) {
        const replyMessage = `Pointer Information:\nChain: ${pointerInfo.chain}\nToken: ${pointerInfo.token}\nStatus: ${pointerInfo.status}`;
        await ctx.reply(replyMessage);
      } else {
        await ctx.reply(`Pointer information could not be found for "${input}". Please make sure you've entered a valid chain name, token denomination, or address.`);
      }
    }
  } catch (error) {
    console.error(`[${new Date().toISOString()}] Error handling pointer lookup for ${input}:`, error);
    await ctx.reply('An error occurred while looking up the pointer information. Please try again or verify your input.');
  }
}

// Utility functions to help determine the input type.
function isValidEthereumAddress(input: string): boolean {
  // Ethereum addresses start with '0x' and are 42 characters long.
  return /^0x[a-fA-F0-9]{40}$/.test(input);
}

function isTokenDenomination(input: string): boolean {
  // Assuming a valid token denomination is usually 3 to 6 characters, typically in uppercase.
  return /^[A-Z]{3,6}$/.test(input);
}
