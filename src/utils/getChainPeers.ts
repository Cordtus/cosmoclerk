import * as fs from "fs";
import * as path from "path";

const REPO_DIR = path.join(__dirname, "../../chain-registry1");

export async function getChainPeers(chain: string): Promise<string[]> {
  const chainDir = path.join(REPO_DIR, chain);
  const chainJsonPath = path.join(chainDir, "peers.json");

  try {
    if (fs.existsSync(chainJsonPath)) {
      const data = JSON.parse(fs.readFileSync(chainJsonPath, "utf8"));
      return data?.peers || [];
    } else {
      console.error(`Peers not found for ${chain}`);
      return [];
    }
  } catch (error) {
    console.error(`[${new Date().toISOString()}] Error reading peers for ${chain}: ${error}`);
    return [];
  }
}
