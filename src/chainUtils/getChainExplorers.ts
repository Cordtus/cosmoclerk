import * as fs from 'fs';
import * as path from 'path';

const REPO_DIR = path.join(__dirname, '../../chain-registry1');

export async function getChainExplorers(chain: string): Promise<string[]> {
  const chainDir = path.join(REPO_DIR, chain);
  const chainJsonPath = path.join(chainDir, 'chain.json');

  try {
    if (fs.existsSync(chainJsonPath)) {
      const data = JSON.parse(fs.readFileSync(chainJsonPath, 'utf8'));
      const explorers =
        data?.explorers?.map((explorer: any) => explorer.url) || [];
      return explorers;
    } else {
      console.error(`Explorers not found for ${chain}`);
      return [];
    }
  } catch (error) {
    console.error(
      `[${new Date().toISOString()}] Error reading explorers for ${chain}: ${error}`,
    );
    return [];
  }
}
