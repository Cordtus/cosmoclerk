import * as fs from 'fs';
import * as path from 'path';

const REPO_DIR = path.join(__dirname, '../../chain-registry1');

export async function listAvailableChains(
  includeTestnets: boolean = false,
): Promise<string[]> {
  try {
    const directories = fs.readdirSync(REPO_DIR);
    const chains = directories.filter((dir) => {
      const chainJsonPath = path.join(REPO_DIR, dir, 'chain.json');
      return fs.existsSync(chainJsonPath);
    });

    if (includeTestnets) {
      const testnetsDir = path.join(REPO_DIR, 'testnets');
      if (fs.existsSync(testnetsDir)) {
        const testnetDirs = fs.readdirSync(testnetsDir);
        const testnets = testnetDirs.filter((dir) => {
          const chainJsonPath = path.join(testnetsDir, dir, 'chain.json');
          return fs.existsSync(chainJsonPath);
        });
        return [...chains, ...testnets];
      }
    }

    return chains;
  } catch (error) {
    console.error(
      `[${new Date().toISOString()}] Error listing available chains:`,
      error,
    );
    return [];
  }
}
