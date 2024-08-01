import fs from 'fs';
import path from 'path';
import { promisify } from 'util';
import { exec } from 'child_process';
import { AppConfig, ChainInfo, AssetInfo } from '../types';

const execAsync = promisify(exec);

export class FileSystemManager {
  private config: AppConfig;

  constructor(config: AppConfig) {
    this.config = config;
  }

  async cloneOrUpdateRepo(): Promise<void> {
    try {
      if (!fs.existsSync(this.config.REPO_DIR)) {
        console.log(`[${new Date().toISOString()}] Cloning repository: ${this.config.REPO_URL}`);
        await execAsync(`git clone ${this.config.REPO_URL} ${this.config.REPO_DIR}`);
        console.log(`[${new Date().toISOString()}] Repository cloned successfully.`);
      } else {
        const stats = fs.statSync(this.config.REPO_DIR);
        const hoursDiff = (new Date().getTime() - stats.mtime.getTime()) / 3600000;
        if (hoursDiff > this.config.STALE_HOURS) {
          await this.updateRepo();
        }
      }
    } catch (error) {
      console.error(`[${new Date().toISOString()}] Error in cloning or updating the repository: ${error.message}`);
      throw error;
    }
  }

  private async updateRepo(): Promise<void> {
    try {
      console.log(`Updating repository in ${this.config.REPO_DIR}`);
      await execAsync(`git -C ${this.config.REPO_DIR} pull`);
      console.log('Repository updated successfully.');
    } catch (updateError) {
      console.log('Error updating repository, attempting to reset:', updateError);
      await execAsync(`git -C ${this.config.REPO_DIR} fetch --all`);
      await execAsync(`git -C ${this.config.REPO_DIR} reset --hard origin/master`);
      await execAsync(`git -C ${this.config.REPO_DIR} pull`);
      console.log('Repository reset and updated successfully.');
    }
  }

  async periodicUpdateRepo(): Promise<void> {
    try {
      await this.cloneOrUpdateRepo();
    } catch (error) {
      console.log('Error during periodic repository update:', error);
    }
  }

  readChainInfo(chain: string, isTestnet: boolean = false): ChainInfo | null {
    const directory = isTestnet ? path.join(this.config.REPO_DIR, 'testnets', chain) : path.join(this.config.REPO_DIR, chain);
    const chainJsonPath = path.join(directory, 'chain.json');
    return this.readJsonFile<ChainInfo>(chainJsonPath);
  }

  readAssetInfo(chain: string, isTestnet: boolean = false): AssetInfo | null {
    const directory = isTestnet ? path.join(this.config.REPO_DIR, 'testnets', chain) : path.join(this.config.REPO_DIR, chain);
    const assetListPath = path.join(directory, 'assetlist.json');
    return this.readJsonFile<AssetInfo>(assetListPath);
  }

  readJsonFile<T>(filePath: string): T | null {
    try {
      if (fs.existsSync(filePath)) {
        const fileContent = fs.readFileSync(filePath, 'utf8');
        return JSON.parse(fileContent) as T;
      } else {
        console.error(`File not found: ${filePath}`);
        return null;
      }
    } catch (error) {
      console.error(`Error reading or parsing file ${filePath}: ${error}`);
      return null;
    }
  }

  async getChainList(isTestnet: boolean = false): Promise<string[]> {
    const directory = isTestnet ? path.join(this.config.REPO_DIR, 'testnets') : this.config.REPO_DIR;
    const directories = fs.readdirSync(directory, { withFileTypes: true })
      .filter(dirent => dirent.isDirectory() && /^[A-Za-z0-9]/.test(dirent.name))
      .map(dirent => dirent.name);

    return directories.sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
  }
}

export function setupFileSystemManager(config: AppConfig): FileSystemManager {
  const fileSystemManager = new FileSystemManager(config);
  
  // Initial update
  fileSystemManager.cloneOrUpdateRepo().catch(console.error);

  // Set up periodic updates
  setInterval(() => fileSystemManager.periodicUpdateRepo(), config.UPDATE_INTERVAL);

  return fileSystemManager;
}