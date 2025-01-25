import { Markup } from 'telegraf';

const DEFAULT_PAGE_SIZE = 18; // Limit to control the number of chains per page.

export function paginateChains(
  chains: string[],
  currentPage: number,
  userId: number,
  pageSize: number = DEFAULT_PAGE_SIZE,
) {
  const totalPages = Math.ceil(chains.length / pageSize);
  const start = currentPage * pageSize;
  const end = start + pageSize;
  const chainsToShow = chains.slice(start, end);

  const buttons = chainsToShow.map((chain) =>
    Markup.button.callback(chain, `select_chain:${chain}`),
  );

  const navigationButtons = [];
  if (currentPage > 0) {
    navigationButtons.push(
      Markup.button.callback('← Previous', `page:${currentPage - 1}`),
    );
  }
  if (currentPage < totalPages - 1) {
    navigationButtons.push(
      Markup.button.callback('Next →', `page:${currentPage + 1}`),
    );
  }

  return Markup.inlineKeyboard([...buttons, ...navigationButtons], {
    columns: 3,
  });
}
