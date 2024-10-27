import * as fs from "fs";
import * as path from "path";

const REPO_DIR = path.join(__dirname, "../../chain-registry1");

export interface ChainInfo {
  name: string;
  rpc: string;
  explorer: string;
}

export async function getChainInfo(chain: string): Promise<ChainInfo | null> {
  const chainDir = path.join(REPO_DIR, chain);
  const chainJsonPath = path.join(chainDir, "chain.json");

  try {
    if (fs.existsSync(chainJsonPath)) {
      const data = JSON.parse(fs.readFileSync(chainJsonPath, "utf8"));
      return {
        name: data.chain_name,
        rpc: data.apis?.rpc?.[0]?.address || "No RPC provided",
        explorer: data.explorers?.[0]?.url || "No Explorer provided",
      };
    } else {
      console.error(`Chain information not found for ${chain}`);
      return null;
    }
  } catch (error) {
    console.error(`[${new Date().toISOString()}] Error reading chain info for ${chain}: ${error}`);
    return null;
  }
}
