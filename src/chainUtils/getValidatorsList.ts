import * as fs from 'fs';
import * as path from 'path';

const REPO_DIR = path.join(__dirname, '../../chain-registry1');

export async function getValidatorsList(chain: string): Promise<any[]> {
  const chainDir = path.join(REPO_DIR, chain);
  const validatorsJsonPath = path.join(chainDir, 'validators.json');

  try {
    if (fs.existsSync(validatorsJsonPath)) {
      const data = JSON.parse(fs.readFileSync(validatorsJsonPath, 'utf8'));
      return data.validators || [];
    } else {
      console.error(`Validators not found for ${chain}`);
      return [];
    }
  } catch (error) {
    console.error(
      `[${new Date().toISOString()}] Error reading validators for ${chain}: ${error}`,
    );
    return [];
  }
}
