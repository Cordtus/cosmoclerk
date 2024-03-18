// coreUtils.js

const { exec } = require('child_process');
const dns = require('dns');
const http = require('http');
const https = require('https');
const unhealthyEndpoints = new Set();

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

function isHostReachable(hostname) {
    if (!hostname) {
        console.error('isHostReachable called with invalid hostname:', hostname);
        return Promise.resolve(false);
    }
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

async function isEndpointHealthy(endpoint, isRpc) {
    // Immediately skip if endpoint starts with 'http://'
if (endpoint.startsWith('http://') || unhealthyEndpoints.has(endpoint)) {
  console.log(`Skipping health check for endpoint with non-secure protocol or known to be unhealthy: ${endpoint}`);
  return false;
}

  if (!await isHostReachable(new URL(endpoint).hostname)) {
      console.log(`${endpoint} is not reachable.`);
      return false;
  }

// Extract hostname without protocol for reachability check
const hostname = new URL(endpoint).hostname;

// Check if the host is reachable
const isReachable = await isHostReachable(hostname);
if (!isReachable) {
  console.log(`Host ${hostname} is not reachable.`);
  unhealthyEndpoints.add(endpoint);
  return false;
}}

function recoverEndpoint(endpoint) {
    unhealthyEndpoints.delete(endpoint);
}

async function findHealthyEndpointOfType(chainData, type) {
    for (const endpoint of chainData.apis[type] || []) {
        if (await isEndpointHealthy(endpoint.address, type === 'rpc')) {
            return endpoint.address;
        }
    }
    return "Unknown";
}

module.exports = { execPromise, isHostReachable, isEndpointHealthy, unhealthyEndpoints, recoverEndpoint };
