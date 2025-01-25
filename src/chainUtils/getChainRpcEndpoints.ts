import * as fs from 'fs';
import * as path from 'path';

const REPO_DIR = path.join(__dirname, '../../chain-registry1');

export async function getChainRpcEndpoints(chain: string): Promise<string[]> {
  const chainDir = path.join(REPO_DIR, chain);
  const chainJsonPath = path.join(chainDir, 'chain.json');

  try {
    if (fs.existsSync(chainJsonPath)) {
      const data = JSON.parse(fs.readFileSync(chainJsonPath, 'utf8'));
      const rpcEndpoints =
        data?.apis?.rpc?.map((rpc: any) => rpc.address) || [];
      return rpcEndpoints;
    } else {
      console.error(`Chain RPC endpoints not found for ${chain}`);
      return [];
    }
  } catch (error) {
    console.error(
      `[${new Date().toISOString()}] Error reading RPC endpoints for ${chain}: ${error}`,
    );
    return [];
  }
}
