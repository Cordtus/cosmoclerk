import * as fs from 'fs';
import * as path from 'path';

const REPO_DIR = path.join(__dirname, '../../chain-registry1/testnets');

export async function getTestnetChainInfo(chain: string): Promise<any> {
  const chainDir = path.join(REPO_DIR, chain);
  const chainJsonPath = path.join(chainDir, 'chain.json');

  try {
    if (fs.existsSync(chainJsonPath)) {
      const data = JSON.parse(fs.readFileSync(chainJsonPath, 'utf8'));
      return {
        name: data.chain_name,
        rpc: data.apis?.rpc?.[0]?.address || 'No RPC provided',
        explorer: data.explorers?.[0]?.url || 'No Explorer provided',
      };
    } else {
      console.error(`Testnet chain information not found for ${chain}`);
      return null;
    }
  } catch (error) {
    console.error(
      `[${new Date().toISOString()}] Error reading testnet chain info for ${chain}: ${error}`,
    );
    return null;
  }
}
