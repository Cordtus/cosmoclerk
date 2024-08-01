import fetch from 'node-fetch';
import { ChainInfo, Endpoint } from '../types';
import { FileSystemManager } from '../utils/fileSystem';

export class EndpointManager {
  private fileSystemManager: FileSystemManager;
  private endpoints: Map<string, Endpoint[]> = new Map();
  private unhealthyEndpoints: Set<string> = new Set();

  constructor(fileSystemManager: FileSystemManager) {
    this.fileSystemManager = fileSystemManager;
  }

  async loadEndpoints(chainName: string): Promise<void> {
    const chainInfo = this.fileSystemManager.readChainInfo(chainName);
    if (!chainInfo) {
      throw new Error(`Chain information not found for ${chainName}`);
    }
    
    this.endpoints.set(`${chainName}_rpc`, chainInfo.apis.rpc);
    this.endpoints.set(`${chainName}_rest`, chainInfo.apis.rest);
    this.endpoints.set(`${chainName}_grpc`, chainInfo.apis.grpc);
  }

  private async isEndpointHealthy(endpoint: string, isRpc: boolean): Promise<boolean> {
    if (endpoint.startsWith('http://') || this.unhealthyEndpoints.has(endpoint)) {
      return false;
    }

    try {
      const url = new URL(isRpc ? '/status' : '/cosmos/base/tendermint/v1beta1/blocks/latest', endpoint);
      const response = await fetch(url.toString(), { timeout: 5000 });
      
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const data = await response.json();
      const latestBlockTime = isRpc 
        ? data.result?.sync_info?.latest_block_time || data.sync_info?.latest_block_time
        : data.block?.header?.time;

      if (!latestBlockTime) {
        throw new Error('Failed to find block time in the response');
      }

      const timeDiff = new Date().getTime() - new Date(latestBlockTime).getTime();
      return timeDiff < 60000; // Consider healthy if less than 60 seconds old
    } catch (error) {
      console.error(`Error checking endpoint ${endpoint}: ${error}`);
      this.unhealthyEndpoints.add(endpoint);
      return false;
    }
  }

  async getHealthyEndpoint(chainName: string, type: 'rpc' | 'rest' | 'grpc'): Promise<string> {
    const endpoints = this.endpoints.get(`${chainName}_${type}`);
    if (!endpoints || endpoints.length === 0) {
      throw new Error(`No ${type.toUpperCase()} endpoints found for ${chainName}`);
    }

    for (const endpoint of endpoints) {
      if (await this.isEndpointHealthy(endpoint.address, type === 'rpc')) {
        return endpoint.address;
      }
    }

    throw new Error(`No healthy ${type.toUpperCase()} endpoints found for ${chainName}`);
  }

  clearUnhealthyEndpoints(): void {
    this.unhealthyEndpoints.clear();
  }

  // Periodically clear unhealthy endpoints
  startPeriodicCleanup(interval: number = 60000): void {
    setInterval(() => this.clearUnhealthyEndpoints(), interval);
  }
}

export async function setupEndpointManager(fileSystemManager: FileSystemManager): Promise<EndpointManager> {
  const endpointManager = new EndpointManager(fileSystemManager);
  endpointManager.startPeriodicCleanup();
  return endpointManager;
}

export async function getChainEndpoints(ctx: BotContext) {
  const userId = ctx.from.id;
  const userAction = ctx.session.userAction;
  if (!userAction || !userAction.chain) {
    await ctx.reply('No chain selected. Please select a chain first.');
    return;
  }

  try {
    const chainInfo = ctx.fileSystemManager.readChainInfo(userAction.chain);
    if (!chainInfo) {
      await ctx.reply(`Error: Data file for ${userAction.chain} is missing or invalid.`);
      return;
    }

    const formatService = (service: Endpoint) => {
      const provider = `*${service.provider.replace(/[^\w\s.-]/g, '').replace(/\./g, '_')}*`;
      const address = `\`${service.address.replace(/\/$/, '').replace(/_/g, '\\_')}\``;
      return `${provider}:\n${address}\n`;
    };

    const formatEndpoints = (services: Endpoint[], title: string, maxEndpoints: number) => {
      if (!services || services.length === 0) {
        return `*${title}*\nNo data available\n`;
      }
      return services.slice(0, maxEndpoints).map(formatService).join("\n");
    };

    let responseSections = [
      `*RPC*\n---\n${formatEndpoints(chainInfo.apis.rpc, "RPC", 5)}`,
      `*REST*\n---\n${formatEndpoints(chainInfo.apis.rest, "REST", 5)}`,
      `*GRPC*\n---\n${formatEndpoints(chainInfo.apis.grpc, "GRPC", 5)}`
    ];

    if (chainInfo.apis['evm-http-jsonrpc']) {
      responseSections.push(`*EVM-HTTP-JSONRPC*\n---\n${formatEndpoints(chainInfo.apis['evm-http-jsonrpc'], "EVM-HTTP-JSONRPC", 5)}`);
    }

    let response = responseSections.filter(section => !section.includes("No data available")).join("\n\n").trim();

    if (response.length > 4096) {
      // Handle long messages (implementation needed)
    } else {
      await ctx.replyWithMarkdown(response);
    }
  } catch (error) {
    console.error(`Error fetching endpoints for ${userAction.chain}:`, error);
    await ctx.reply(`Error fetching endpoints for ${userAction.chain}. Please try again.`);
  }
}