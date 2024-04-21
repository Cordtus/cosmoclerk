// coreUtils.js

const dns = require('dns');
const fetch = require('node-fetch');
const config = require('../config');
const unhealthyEndpoints = new Set();

function isHostReachable(hostname) {
    return new Promise((resolve, reject) => {
        dns.lookup(hostname, { timeout: config.dnsTimeout }, (err) => {
            if (err) reject(err);
            else resolve(true);
        });
    });
}

function fetchWithTimeout(url, timeout = config.fetchTimeout) {
    const controller = new AbortController();
    const timeoutSignal = setTimeout(() => controller.abort(), timeout);
    return fetch(url, { signal: controller.signal })
        .then(response => {
            clearTimeout(timeoutSignal);
            return response;
        })
        .catch(error => {
            clearTimeout(timeoutSignal);
            throw error;
        });
}

async function fetchJson(url, timeout = config.fetchTimeout) {
    try {
        const response = await fetchWithTimeout(url, timeout);
        if (!response.ok) {
            console.error(`Error fetching ${url}: ${response.status} ${response.statusText}`);
            return null;
        }
        return response.json();
    } catch (error) {
        console.error(`Exception while fetching ${url}: ${error.message}`);
        return null;
    }
}

async function isEndpointHealthy(endpoint, type) {
    if (unhealthyEndpoints.has(endpoint)) {
        console.log(`Skipping known unhealthy endpoint: ${endpoint}`);
        return false;
    }

    const hostname = new URL(endpoint).hostname;
    if (!await isHostReachable(hostname)) {
        console.log(`Host not reachable: ${hostname}`);
        unhealthyEndpoints.add(endpoint);
        return false;
    }

    try {
        const healthCheckUrl = type === 'rpc' ? endpoint + '/status' : endpoint + '/cosmos/base/tendermint/v1beta1/blocks/latest';
        const response = await fetchJson(healthCheckUrl);
        if (!response) throw new Error("Failed to fetch health check data");

        const latestBlockTime = new Date(type === 'rpc' ? response.result.sync_info.latest_block_time : response.block.header.time);
        const timeDiff = Math.abs(new Date() - latestBlockTime) / 1000;

        if (timeDiff > 60) {
            console.log(`Endpoint out of sync: ${endpoint}`);
            unhealthyEndpoints.add(endpoint);
            return false;
        }
    } catch (error) {
        console.error(`Failed to check health for ${endpoint}: ${error}`);
        unhealthyEndpoints.add(endpoint);
        return false;
    }

    return true;
}

function recoverEndpoint(endpoint) {
    unhealthyEndpoints.delete(endpoint);
}

function periodicallyCheckUnhealthyEndpoints(interval = 180000) {
    setInterval(() => {
        unhealthyEndpoints.forEach(async (endpoint) => {
            if (await isEndpointHealthy(endpoint, false)) {
                console.log(`Endpoint recovered: ${endpoint}`);
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
