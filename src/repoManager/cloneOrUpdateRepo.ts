import * as fs from 'fs';
import * as path from 'path';

import { execPromise } from '../botUtils/execPromise';

const REPO_URL = 'https://github.com/cosmos/chain-registry.git';
const REPO_DIR = path.join(__dirname, '../../chain-registry1');
const STALE_HOURS = 6;

export async function cloneOrUpdateRepo(): Promise<void> {
  try {
    if (!fs.existsSync(REPO_DIR)) {
      console.log(
        `[${new Date().toISOString()}] Cloning repository: ${REPO_URL}`,
      );
      await execPromise(`git clone ${REPO_URL} ${REPO_DIR}`);
      console.log(
        `[${new Date().toISOString()}] Repository cloned successfully.`,
      );
    } else {
      const stats = fs.statSync(REPO_DIR);
      const hoursDiff =
        (new Date().getTime() - new Date(stats.mtime).getTime()) / 3600000;
      if (hoursDiff > STALE_HOURS) {
        try {
          console.log(`Updating repository in ${REPO_DIR}`);
          await execPromise(`git -C ${REPO_DIR} pull`);
        } catch (updateError) {
          console.log(
            'Error updating repository, attempting to reset:',
            updateError,
          );
          await execPromise(`git -C ${REPO_DIR} reset --hard origin/master`);
          await execPromise(`git -C ${REPO_DIR} pull`);
          console.log('Repository reset and updated successfully.');
        }
      }
    }
  } catch (error) {
    if (error instanceof Error) {
      console.error(`[${new Date().toISOString()}] Error: ${error.message}`);
    } else {
      console.error(`[${new Date().toISOString()}] Unknown error`, error);
    }
  }
}
