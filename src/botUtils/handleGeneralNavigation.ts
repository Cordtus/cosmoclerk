import { Context } from "telegraf";

export async function handleGeneralNavigation(ctx: Context, options: string[], currentPage: number, pageSize: number = 5): Promise<void> {
  const start = currentPage * pageSize;
  const end = start + pageSize;
  const optionsToShow = options.slice(start, end);

  const buttons = optionsToShow.map(option => ({
    text: option,
    callback_data: `option:${option}`
  }));

  const navigationButtons = [];
  if (currentPage > 0) {
    navigationButtons.push({ text: '← Previous', callback_data: `page:${currentPage - 1}` });
  }
  if (end < options.length) {
    navigationButtons.push({ text: 'Next →', callback_data: `page:${currentPage + 1}` });
  }

  await ctx.reply('Please choose an option:', {
    reply_markup: {
      inline_keyboard: [...buttons.map(b => [b]), navigationButtons]
    }
  });
}
