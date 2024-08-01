import { readFileSafely } from '../utils/fileSystem';
import { REPO_DIR } from '../config/config';
import path from 'path';
import { ChainInfo, AssetInfo, PeerNodes, Explorer } from '../types';

export async function getChainInfo(chain: string, isTestnet: boolean = false): Promise<ChainInfo | null> {
  const directory = isTestnet ? path.join(REPO_DIR, 'testnets', chain) : path.join(REPO_DIR, chain);
  const chainJsonPath = path.join(directory, 'chain.json');
  return readFileSafely<ChainInfo>(chainJsonPath);
}

export async function getAssetInfo(chain: string, isTestnet: boolean = false): Promise<AssetInfo | null> {
  const directory = isTestnet ? path.join(REPO_DIR, 'testnets', chain) : path.join(REPO_DIR, chain);
  const assetListPath = path.join(directory, 'assetlist.json');
  return readFileSafely<AssetInfo>(assetListPath);
}

export async function getPeerNodes(chain: string, isTestnet: boolean = false): Promise<PeerNodes | null> {
  const chainInfo = await getChainInfo(chain, isTestnet);
  return chainInfo ? chainInfo.peers : null;
}

export async function getEndpoints(chain: string, isTestnet: boolean = false): Promise<ChainInfo['apis'] | null> {
  const chainInfo = await getChainInfo(chain, isTestnet);
  return chainInfo ? chainInfo.apis : null;
}

export async function getBlockExplorers(chain: string, isTestnet: boolean = false): Promise<Explorer[] | null> {
  const chainInfo = await getChainInfo(chain, isTestnet);
  return chainInfo ? chainInfo.explorers : null;
}

export async function getBaseDenom(chain: string, isTestnet: boolean = false): Promise<string | null> {
  const assetInfo = await getAssetInfo(chain, isTestnet);
  return assetInfo ? assetInfo.base : null;
}

export async function getDecimals(chain: string, isTestnet: boolean = false): Promise<number | null> {
  const assetInfo = await getAssetInfo(chain, isTestnet);
  if (assetInfo && assetInfo.denom_units) {
    const nativeDenomExponent = assetInfo.denom_units.slice(-1)[0];
    return nativeDenomExponent ? nativeDenomExponent.exponent : null;
  }
  return null;
}

export async function getAddressPrefix(chain: string, isTestnet: boolean = false): Promise<string | null> {
  const chainInfo = await getChainInfo(chain, isTestnet);
  return chainInfo ? chainInfo.bech32_prefix : null;
}

export async function getCoinType(chain: string, isTestnet: boolean = false): Promise<number | null> {
  const chainInfo = await getChainInfo(chain, isTestnet);
  return chainInfo ? chainInfo.slip44 : null;
}

export function findPreferredExplorer(explorers: Explorer[] | null): string | null {
  if (!explorers || explorers.length === 0) return null;

  const stripPrefixes = (name: string) => {
    return name.replace(/^(http:\/\/|https:\/\/)?(www\.)?/, '');
  };

  const preferredOrder = ['c', 'm'];
  const sortedExplorers = explorers
    .map(explorer => ({
      ...explorer,
      compareUrl: stripPrefixes(explorer.url)
    }))
    .sort((a, b) => {
      for (const letter of preferredOrder) {
        if (a.compareUrl.startsWith(letter) && b.compareUrl.startsWith(letter)) {
          return a.compareUrl.localeCompare(b.compareUrl);
        }
      }
      if (a.compareUrl.startsWith(preferredOrder[0])) return -1;
      if (b.compareUrl.startsWith(preferredOrder[0])) return 1;
      if (a.compareUrl.startsWith(preferredOrder[1])) return -1;
      if (b.compareUrl.startsWith(preferredOrder[1])) return 1;
      return a.compareUrl.localeCompare(b.compareUrl);
    });

  return sortedExplorers.length > 0 ? sortedExplorers[0].url : null;
}