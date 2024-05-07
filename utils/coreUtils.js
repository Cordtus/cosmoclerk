// coreUtils.js

const { dnsTimeout, fetchTimeout } = require('./config');
const dns = require('dns');
const unhealthyEndpoints = new Set(); // Initialize an empty Set to track unhealthy endpoints

// Check if a host is reachable within a specified timeout
function isHostReachable(hostname) {
    return new Promise((resolve, reject) => {
        dns.lookup(hostname, { timeout: dnsTimeout }, (err) => {
            if (err) reject(new Error(`Host ${hostname} not reachable: ${err.message}`));
            else resolve(true);
        });
    });
}

// Fetch data from a URL with a timeout mechanism
function fetchWithTimeout(url, timeout = config.fetchTimeout) {
    const controller = new AbortController();
    const timeoutSignal = setTimeout(() => controller.abort(), timeout);
    return fetch(url, { signal: controller.signal })
        .then(response => {
            clearTimeout(timeoutSignal);
            if (!response.ok) throw new Error(`Failed to fetch ${url}: ${response.statusText}`);
            return response;
        })
        .catch(error => {
            clearTimeout(timeoutSignal);
            throw new Error(`Fetch with timeout error: ${error.message}`);
        });
}

// Fetch JSON from a URL with timeout handling
async function fetchJson(url, timeout = fetchTimeout) {
    try {
        const response = await fetchWithTimeout(url, timeout);
        return await response.json();
    } catch (error) {
        console.error(`Exception while fetching JSON from ${url}: ${error.message}`);
        return null;
    }
}

// Check if an endpoint is healthy based on its response time and accessibility
async function isEndpointHealthy(endpoint, type) {
    if (unhealthyEndpoints.has(endpoint)) {
        console.log(`Skipping known unhealthy endpoint: ${endpoint}`);
        return false;
    }

    try {
        const hostname = new URL(endpoint).hostname;
        await isHostReachable(hostname);
        const healthCheckUrl = type === 'rpc' ? endpoint + '/status' : endpoint + '/cosmos/base/tendermint/v1beta1/blocks/latest';
        const response = await fetchJson(healthCheckUrl);

        const latestBlockTime = new Date(type === 'rpc' ? response.result.sync_info.latest_block_time : response.block.header.time);
        const timeDiff = Math.abs(new Date() - latestBlockTime) / 1000;

        if (timeDiff > 60) {
            console.log(`Endpoint ${endpoint} out of sync: ${timeDiff}s delay`);
            unhealthyEndpoints.add(endpoint);
            return false;
        }
        return true;
    } catch (error) {
        console.error(`Failed to verify health for ${endpoint}: ${error}`);
        unhealthyEndpoints.add(endpoint);
        return false;
    }
}

// Attempt to recover a previously unhealthy endpoint
function recoverEndpoint(endpoint) {
    if (unhealthyEndpoints.delete(endpoint)) {
        console.log(`Recovered endpoint: ${endpoint}`);
    }
}

// Periodically check and attempt to recover unhealthy endpoints
function periodicallyCheckUnhealthyEndpoints(interval = 180000) {
    setInterval(() => {
        unhealthyEndpoints.forEach(async (endpoint) => {
            if (await isEndpointHealthy(endpoint, false)) {
                recoverEndpoint(endpoint);
            }
        });
    }, interval);
}

async function findHealthyEndpoint(ctx, chainData, type) {
    console.log(`Checking health for endpoints of type: ${type}`);
    if (!chainData.apis || !chainData.apis[type]) {
        console.log(`No endpoints found for type: ${type}`);
        return "Unknown"; // Return "Unknown" if no endpoints of this type exist
    }

    for (const endpoint of chainData.apis[type]) {
        try {
            if (await isEndpointHealthy(endpoint.address, type)) {
                return endpoint.address;
            }
        } catch (error) {
            console.error(`Failed to check health for endpoint: ${endpoint.address}`, error);
        }
    }
    return "Unknown"; // Return "Unknown" if no healthy endpoint found
}

function sanitizeUrl(url) {
    // Escape special MarkdownV2 characters
    return url.replace(/[()]/g, '\\$&'); // Add more characters if needed for escaping
}

function sanitizeString(name) {
    // Sanitizing provider names to remove emojis and replace special characters
    return name.replace(/[\u{1F600}-\u{1F64F}]/gu, '').replace(/[^\w\s]/g, '_');
}

function sanitizeInput(input) {
    return encodeURIComponent(input);
}

function validateAddress(address) {
    if (!/^0x[a-fA-F0-9]{40}$|^[a-zA-Z1-9]{42}$/.test(address)) {
        throw new Error("Invalid address format.");
    }
    return address;
}

function escapeMarkdown(url) {
    // Escape underscores and other Markdown special characters in URLs
    return url.replace(/[_]/g, '\\$&');
}

module.exports = {
    fetchJson,
    fetchWithTimeout,
    isHostReachable,
    isEndpointHealthy,
    findHealthyEndpoint,
    recoverEndpoint,
    periodicallyCheckUnhealthyEndpoints,
    sanitizeUrl,
    sanitizeString,
    sanitizeInput,
    validateAddress,
    escapeMarkdown,
};
