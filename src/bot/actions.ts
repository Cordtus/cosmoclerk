import { Markup, Context } from 'telegraf';
import { BotContext } from '../types';
import { getChainInfo } from '../chain/chainInfo';
import { EndpointManager, getChainEndpoints } from '../chain/endpoints';
import { FileSystemManager } from '../utils/fileSystem';
import { getChainPeerNodes } from '../chain/peerNodes';
import { getBlockExplorers } from '../chain/blockExplorers';
import { resetSessionAndShowChains, paginateChains } from '../utils/pagination';
import { getChainList, getTestnetsList } from '../utils/chainList';
import { queryIbcId } from '../chain/ibcDenom';
import { handlePoolIncentives, handlePoolInfo } from '../chain/poolOperations';
import { handlePriceInfo } from '../chain/priceInfo';

export class BotActions {
  private fileSystemManager: FileSystemManager;
  private endpointManager: EndpointManager;

  constructor(fileSystemManager: FileSystemManager, endpointManager: EndpointManager) {
    this.fileSystemManager = fileSystemManager;
    this.endpointManager = endpointManager;
  }

  async handleStart(ctx: BotContext) {
    await resetSessionAndShowChains(ctx);
  }

  async handleRestart(ctx: BotContext) {
    await resetSessionAndShowChains(ctx);
  }

  async handleChainInfo(ctx: BotContext) {
    const chainName = ctx.session.userAction.chain;
    if (!chainName) {
      await ctx.reply('No chain selected. Please select a chain first.');
      return;
    }

    try {
      await this.endpointManager.loadEndpoints(chainName);
      const chainInfo = this.fileSystemManager.readChainInfo(chainName);
      const assetInfo = this.fileSystemManager.readAssetInfo(chainName);

      if (!chainInfo || !assetInfo) {
        await ctx.reply('Unable to fetch chain information.');
        return;
      }

      const rpcEndpoint = await this.endpointManager.getHealthyEndpoint(chainName, 'rpc');
      const restEndpoint = await this.endpointManager.getHealthyEndpoint(chainName, 'rest');

      const message = `Chain ID: \`${chainInfo.chain_id}\`\n` +
        `Chain Name: \`${chainInfo.chain_name}\`\n` +
        `RPC: \`${rpcEndpoint}\`\n` +
        `REST: \`${restEndpoint}\`\n` +
        `Address Prefix: \`${chainInfo.bech32_prefix}\`\n` +
        `Base Denom: \`${assetInfo.base}\`\n` +
        `Cointype: \`${chainInfo.slip44}\`\n` +
        `Decimals: \`${assetInfo.denom_units.slice(-1)[0].exponent}\`\n` +
        `Block Explorer: \`${chainInfo.explorers[0]?.url || 'Unknown'}\``;

      await ctx.reply(message, { parse_mode: 'Markdown' });
    } catch (error) {
      console.error(`Error fetching chain info for ${chainName}:`, error);
      await ctx.reply(`Error fetching data for ${chainName}. Please try again later.`);
    }
  }

  async handleEndpoints(ctx: BotContext) {
    await getChainEndpoints(ctx);
  }

  async handlePeerNodes(ctx: BotContext) {
    const chainName = ctx.session.userAction.chain;
    if (!chainName) {
      await ctx.reply('No chain selected. Please select a chain first.');
      return;
    }
    const peerNodesMessage = await getChainPeerNodes(this.fileSystemManager, chainName);
    await ctx.reply(peerNodesMessage, { parse_mode: 'Markdown' });
  }

  async handleBlockExplorers(ctx: BotContext) {
    const chainName = ctx.session.userAction.chain;
    if (!chainName) {
      await ctx.reply('No chain selected. Please select a chain first.');
      return;
    }
    const blockExplorersMessage = await getBlockExplorers(this.fileSystemManager, chainName);
    await ctx.replyWithMarkdown(blockExplorersMessage);
  }

  async handleIbcDenom(ctx: BotContext, ibcDenom: string) {
    const chainName = ctx.session.userAction.chain;
    if (!chainName) {
      await ctx.reply('No chain selected. Please select a chain first.');
      return;
    }
    const baseDenom = await queryIbcId(ctx, ibcDenom, chainName, true);
    if (baseDenom) {
      await ctx.reply(`Base Denomination: ${baseDenom}`);
    } else {
      await ctx.reply('Failed to fetch IBC denom trace or it does not exist.');
    }
  }

  async handlePoolIncentives(ctx: BotContext, poolId: number) {
    await handlePoolIncentives(ctx, poolId);
  }

  async handlePoolInfo(ctx: BotContext, poolId: number) {
    await handlePoolInfo(ctx, poolId);
  }

  async handlePriceInfo(ctx: BotContext, tokenTicker: string) {
    await handlePriceInfo(ctx, tokenTicker);
  }

  async handleMainMenuAction(ctx: BotContext, action: string, chain: string) {
    switch (action) {
      case 'chain_info':
        await this.handleChainInfo(ctx);
        break;
      case 'peer_nodes':
        await this.handlePeerNodes(ctx);
        break;
      case 'endpoints':
        await this.handleEndpoints(ctx);
        break;
      case 'block_explorers':
        await this.handleBlockExplorers(ctx);
        break;
      case 'ibc_id':
        await ctx.reply(`Enter IBC denom for ${chain}:`, { parse_mode: 'Markdown' });
        break;
      case 'pool_incentives':
        if (chain === 'osmosis') {
          await ctx.reply('Enter pool_id for osmosis:');
          ctx.session.expectedAction = 'awaiting_pool_id';
        } else {
          await ctx.reply('Pool incentives are only available for Osmosis.');
        }
        break;
      case 'pool_info':
        if (chain === 'osmosis') {
          await ctx.reply('Enter pool_id for Osmosis:');
          ctx.session.expectedAction = 'awaiting_pool_id_info';
        } else {
          await ctx.reply('Pool info is only available for Osmosis.');
        }
        break;
      case 'price_info':
        if (chain === 'osmosis') {
          await ctx.reply('Enter token ticker for Price Info:');
          ctx.session.expectedAction = 'awaiting_token_ticker';
        } else {
          await ctx.reply('Price info is only available for Osmosis.');
        }
        break;
      default:
        await ctx.reply('Invalid option selected. Please try again.');
        break;
    }
  }

  async handlePageNavigation(ctx: BotContext, page: number) {
    const chains = await getChainList(this.fileSystemManager);
    const keyboard = paginateChains(chains, page, ctx.from.id, 18); // Assuming pageSize is 18
    await ctx.editMessageReplyMarkup(keyboard.reply_markup);
  }

  async handleChainSelection(ctx: BotContext, chain: string) {
    if (chain === 'testnets') {
      const testnetsList = await getTestnetsList(this.fileSystemManager);
      const keyboardMarkup = paginateChains(testnetsList, 0, ctx.from.id, 18);
      await ctx.reply('Select a testnet:', keyboardMarkup);
    } else {
      ctx.session.userAction = { ...ctx.session.userAction, chain };
      const keyboardMarkup = this.sendMainMenu(ctx, ctx.from.id);
      await ctx.editMessageText('Select an action:', {
        parse_mode: 'Markdown',
        disable_web_page_preview: true,
        reply_markup: keyboardMarkup.reply_markup
      });
    }
  }

  private sendMainMenu(ctx: BotContext, userId: number) {
    const userAction = ctx.session.userAction;
    const mainMenuButtons = [
      Markup.button.callback('1. Chain Info', 'chain_info'),
      Markup.button.callback('2. Peer Nodes', 'peer_nodes'),
      Markup.button.callback('3. Endpoints', 'endpoints'),
      Markup.button.callback('4. Block Explorers', 'block_explorers')
    ];

    if (!userAction.browsingTestnets) {
      mainMenuButtons.push(Markup.button.callback('5. IBC-ID', 'ibc_id'));
      if (userAction.chain === 'osmosis') {
        mainMenuButtons.push(Markup.button.callback('6. LP Incentives', 'pool_incentives'));
        mainMenuButtons.push(Markup.button.callback('7. Pool Info', 'pool_info'));
        mainMenuButtons.push(Markup.button.callback('8. Price Info', 'price_info'));
      }
    }

    return Markup.inlineKeyboard(mainMenuButtons, { columns: 2 });
  }

  async handlePageNavigation(ctx: BotContext, page: number) {
    const chains = await getChainList(this.fileSystemManager);
    const keyboard = this.paginateChains(chains, page, ctx.from.id);
    await ctx.editMessageReplyMarkup({ inline_keyboard: keyboard.reply_markup.inline_keyboard });
  }

  private paginateChains(chains: string[], currentPage: number, userId: number) {
    const pageSize = 18;
    const totalPages = Math.ceil(chains.length / pageSize);
    const start = currentPage * pageSize;
    const end = start + pageSize;
    const chainsToShow = chains.slice(start, end);
    const lastSelectedChain = this.userLastAction[userId]?.chain;

    const buttons = chainsToShow.map(chain => {
      const isSelected = chain === lastSelectedChain;
      const buttonText = isSelected ? `🔴 ${chain}` : chain;
      return Markup.button.callback(buttonText, `select_chain:${chain}`);
    });

    const rowsOfButtons = [];
    for (let i = 0; i < buttons.length; i += 3) {
      rowsOfButtons.push(buttons.slice(i, i + 3));
    }

    const navigationButtons = [];
    if (currentPage > 0) {
      navigationButtons.push(Markup.button.callback('← Previous', `page:${currentPage - 1}`));
    }
    if (currentPage < totalPages - 1) {
      navigationButtons.push(Markup.button.callback('Next →', `page:${currentPage + 1}`));
    }

    if (navigationButtons.length > 0) {
      rowsOfButtons.push(navigationButtons);
    }

    return Markup.inlineKeyboard(rowsOfButtons);
  }

  async handleChainSelection(ctx: BotContext, chain: string) {
    const userId = ctx.from.id;

    if (chain === 'testnets') {
      const testnetsList = await getTestnetsList(this.fileSystemManager);
      const keyboardMarkup = this.paginateChains(testnetsList, 0, userId);
      await ctx.reply('Select a testnet:', keyboardMarkup);
    } else {
      ctx.session.userAction = {
        ...ctx.session.userAction,
        chain,
        browsingTestnets: false
      };

      const keyboardMarkup = this.sendMainMenu(ctx, userId);
      await ctx.editMessageText('Select an action:', {
        parse_mode: 'Markdown',
        disable_web_page_preview: true,
        reply_markup: keyboardMarkup.reply_markup
      });
    }
  }

  async handleStart(ctx: BotContext) {
    await this.resetSessionAndShowChains(ctx);
  }

  async handleRestart(ctx: BotContext) {
    await this.resetSessionAndShowChains(ctx);
  }

  private async resetSessionAndShowChains(ctx: BotContext) {
    const userId = ctx.from.id;
    ctx.session.userAction = {};
    ctx.session.expectedAction = undefined;

    const chains = await getChainList(this.fileSystemManager);
    const keyboard = this.paginateChains(chains, 0, userId);
    await ctx.reply('Please select a chain:', keyboard);
  }

  async handleTextInput(ctx: BotContext) {
    const text = ctx.message.text.trim().toLowerCase();
    const userId = ctx.from.id;

    if (text === '/start' || text === '/restart') {
      await this.resetSessionAndShowChains(ctx);
    } else if (ctx.session.expectedAction === 'awaiting_token_ticker') {
      await this.handlePriceInfo(ctx, text);
      ctx.session.expectedAction = undefined;
    } else if (ctx.session.expectedAction === 'awaiting_pool_id') {
      const poolId = parseInt(text, 10);
      if (isNaN(poolId)) {
        await ctx.reply('Please enter a valid pool_id.');
      } else {
        await this.handlePoolIncentives(ctx, poolId);
        ctx.session.expectedAction = undefined;
      }
    } else if (ctx.session.expectedAction === 'awaiting_pool_id_info') {
      const poolId = parseInt(text, 10);
      if (isNaN(poolId)) {
        await ctx.reply('Please enter a valid pool_id for Pool Info.');
      } else {
        await this.handlePoolInfo(ctx, poolId);
        ctx.session.expectedAction = undefined;
      }
    } else if (text.startsWith('ibc/')) {
      await this.handleIbcDenom(ctx, text.slice(4));
    } else if (!isNaN(parseInt(text))) {
      const optionIndex = parseInt(text) - 1;
      const mainMenuOptions = ['chain_info', 'peer_nodes', 'endpoints', 'block_explorers', 'ibc_id', 'pool_incentives', 'pool_info', 'price_info'];
      if (optionIndex >= 0 && optionIndex < mainMenuOptions.length) {
        await this.handleMainMenuAction(ctx, mainMenuOptions[optionIndex], ctx.session.userAction.chain);
      } else {
        await ctx.reply('Invalid option number. Please try again.');
      }
    } else {
      const chains = await getChainList(this.fileSystemManager);
      if (chains.map(chain => chain.toLowerCase()).includes(text)) {
        ctx.session.userAction = { ...ctx.session.userAction, chain: text };
        const keyboardMarkup = this.sendMainMenu(ctx, userId);
        await ctx.reply('Select an action:', keyboardMarkup);
      } else {
        await ctx.reply('Unrecognized command. Please try again or use the menu options.');
      }
    }
  }
}

export const botActions = new BotActions(new FileSystemManager(), new EndpointManager());