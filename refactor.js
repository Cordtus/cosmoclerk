const { Telegraf, Markup } = require("telegraf");
const fs = require("fs");
const path = require("path");
const exec = require("child_process").exec;
const fetch = require('node-fetch');
const dns = require('dns');
const { URL } = require('url');

const BOT_TOKEN = process.env.BOT_TOKEN;
const bot = new Telegraf(BOT_TOKEN);

const REPO_URL = "https://github.com/cosmos/chain-registry.git";
const REPO_DIR = path.join(__dirname, 'chain-registry1');
const STALE_HOURS = 6;
const UPDATE_INTERVAL = STALE_HOURS * 3600000; // in milliseconds

const pageSize = 18;

const unhealthyEndpoints = new Set();

let userLastAction = {};
const expectedAction = {};

// Utility functions
async function makeHttpRequest(url, options = {}) {
    try {
        const response = await fetch(url, options);
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        return await response.json();
    } catch (error) {
        console.error(`Error making request to ${url}:`, error);
        throw error;
    }
}

function readJsonFile(filePath) {
    try {
        const fullPath = path.resolve(__dirname, filePath);
        if (fs.existsSync(fullPath)) {
            const data = fs.readFileSync(fullPath, 'utf8');
            return JSON.parse(data);
        } else {
            console.error(`File not found: ${fullPath}`);
            return null;
        }
    } catch (error) {
        console.error(`Error reading or parsing file ${filePath}:`, error);
        return null;
    }
}

async function editOrSendMessage(ctx, userId, message, options = {}) {
    const userAction = userLastAction[userId];
    if (userAction && userAction.messageId) {
        try {
            await ctx.telegram.editMessageText(
                userAction.chatId,
                userAction.messageId,
                null,
                message,
                options
            );
        } catch (error) {
            console.error('Error editing message:', error);
            const sentMessage = await ctx.reply(message, options);
            updateUserLastAction(userId, {
                messageId: sentMessage.message_id,
                chatId: sentMessage.chat.id
            });
        }
    } else {
        const sentMessage = await ctx.reply(message, options);
        updateUserLastAction(userId, {
            messageId: sentMessage.message_id,
            chatId: sentMessage.chat.id
        });
    }
}

async function getEndpointHealth(endpoint, type) {
  if (endpoint.startsWith('http://') || unhealthyEndpoints.has(endpoint)) {
      console.log(`Skipping health check for non-secure or known unhealthy endpoint: ${endpoint}`);
      return { isHealthy: false, latestBlockTime: null, error: 'Insecure or known unhealthy endpoint' };
  }

  const url = new URL(endpoint);
  if (!await isHostReachable(url.hostname)) {
      console.log(`${endpoint} is not reachable.`);
      return { isHealthy: false, latestBlockTime: null, error: 'Host not reachable' };
  }

  let checkUrl, parseResponse, fetchOptions;

  switch (type) {
      case 'rpc':
          checkUrl = new URL('/status', endpoint).href;
          parseResponse = (data) => data.result?.sync_info?.latest_block_time || data.sync_info?.latest_block_time;
          break;
      case 'rest':
          checkUrl = new URL('/cosmos/base/tendermint/v1beta1/blocks/latest', endpoint).href;
          parseResponse = (data) => data.block?.header?.time;
          break;
      case 'grpc':
          console.log('gRPC health check not implemented');
          return { isHealthy: false, latestBlockTime: null, error: 'gRPC health check not implemented' };
      case 'evm-http-jsonrpc':
          return await checkEvmRpcHealth(endpoint);
      default:
          console.error(`Unknown endpoint type: ${type}`);
          return { isHealthy: false, latestBlockTime: null, error: 'Unknown endpoint type' };
  }

  try {
      const data = await makeHttpRequest(checkUrl, { ...fetchOptions, timeout: 5000 });
      const latestBlockTime = parseResponse(data);
      
      if (!latestBlockTime) {
          throw new Error(`Failed to find latest block time in the ${type} response`);
      }

      const timeDiff = new Date() - new Date(latestBlockTime);
      const isHealthy = timeDiff < 60000; // Consider healthy if less than 60 seconds old

      return {
          isHealthy,
          latestBlockTime: new Date(latestBlockTime).toUTCString(),
          timeSinceLastBlock: `${Math.round(timeDiff / 1000)} seconds`
      };
  } catch (error) {
      console.error(`Error checking ${type} endpoint ${endpoint}:`, error);
      unhealthyEndpoints.add(endpoint);
      return { isHealthy: false, latestBlockTime: null, error: error.message };
  }
}

async function checkEvmRpcHealth(endpoint) {
  try {
      const blockNumberData = await fetch(endpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ jsonrpc: '2.0', method: 'eth_blockNumber', params: [], id: 1 }),
      }).then(res => res.json());

      const blockDetailsData = await fetch(endpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
              jsonrpc: '2.0',
              method: 'eth_getBlockByNumber',
              params: [blockNumberData.result, false],
              id: 1,
          }),
      }).then(res => res.json());

      const timestampHex = blockDetailsData.result.timestamp;
      const latestBlockTime = new Date(parseInt(timestampHex, 16) * 1000);

      const timeDiff = new Date() - latestBlockTime;
      const isHealthy = timeDiff < 60000; // Consider healthy if less than 60 seconds old

      return {
          isHealthy,
          latestBlockTime: latestBlockTime.toUTCString(),
          timeSinceLastBlock: `${Math.round(timeDiff / 1000)} seconds`
      };
  } catch (error) {
      console.error('Error fetching the latest block timestamp:', error);
      return { isHealthy: false, latestBlockTime: null, error: error.message };
  }
}

// The findHealthyEndpoint function remains unchanged
async function findHealthyEndpoint(endpoints, type) {
  for (const endpoint of endpoints) {
      const health = await getEndpointHealth(endpoint.address, type);
      if (health.isHealthy) {
          return {
              address: endpoint.address,
              health: health
          };
      }
  }
  return { address: "Unknown", health: { isHealthy: false, error: "No healthy endpoints found" } };
}

async function isHostReachable(hostname) {
    return new Promise((resolve) => {
        dns.lookup(hostname, (err) => {
            if (err) {
                console.error(`DNS lookup failed for host: ${hostname}, Error: ${err.message}`);
                resolve(false);
            } else {
                resolve(true);
            }
        });
    });
}

async function findHealthyEndpoint(endpoints, type) {
    for (const endpoint of endpoints) {
        if (await isEndpointHealthy(endpoint.address, type)) {
            return endpoint.address;
        }
    }
    return "Unknown"; // Return Unknown if no healthy endpoint found
}

function execPromise(command) {
    return new Promise((resolve, reject) => {
        exec(command, (error, stdout, stderr) => {
            if (error) {
                reject(error);
                return;
            }
            resolve(stdout.trim());
        });
    });
}

// Helper function to update user's last action
function updateUserLastAction(userId, data) {
    if (data) {
        userLastAction[userId] = {
            ...data,
            timestamp: new Date()
        };
    } else {
        // Reset session data if null data is provided
        delete userLastAction[userId];
    }
}

// ... (rest of the code will follow)