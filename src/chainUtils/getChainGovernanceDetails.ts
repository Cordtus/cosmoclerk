import * as fs from 'fs';
import * as path from 'path';

const REPO_DIR = path.join(__dirname, '../../chain-registry1');

export async function getChainGovernanceDetails(chain: string): Promise<any> {
  const chainDir = path.join(REPO_DIR, chain);
  const governanceJsonPath = path.join(chainDir, 'governance.json');

  try {
    if (fs.existsSync(governanceJsonPath)) {
      const data = JSON.parse(fs.readFileSync(governanceJsonPath, 'utf8'));
      return {
        proposals: data.proposals || [],
        staking: data.staking || 'Not Available',
      };
    } else {
      console.error(`Governance details not found for ${chain}`);
      return {};
    }
  } catch (error) {
    console.error(
      `[${new Date().toISOString()}] Error reading governance details for ${chain}: ${error}`,
    );
    return {};
  }
}
