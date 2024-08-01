import path from 'path';
import { AppConfig } from '../types';

export const BOT_TOKEN = process.env.BOT_TOKEN || '';
export const REPO_URL = "https://github.com/cosmos/chain-registry.git";
export const REPO_DIR = path.join(__dirname, '..', '..', 'chain-registry');
export const STALE_HOURS = 6;
export const UPDATE_INTERVAL = STALE_HOURS * 3600000; // in milliseconds
export const PAGE_SIZE = 18;

const config: AppConfig = {
  BOT_TOKEN: process.env.BOT_TOKEN || '',
  REPO_URL: "https://github.com/cosmos/chain-registry.git",
  REPO_DIR: path.join(__dirname, '..', '..', 'chain-registry'),
  STALE_HOURS: 6,
  UPDATE_INTERVAL: 6 * 3600000, // 6 hours in milliseconds
  PAGE_SIZE: 18,
};

export default config;