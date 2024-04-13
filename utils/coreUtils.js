// coreUtils.js

const dns = require('dns');
const fetch = require('node-fetch');
const unhealthyEndpoints = new Set();


function isHostReachable(hostname) {
    return new Promise((resolve) => {
        dns.lookup(hostname, (err) => {
            resolve(!err);
        });
    });
}

async function isEndpointHealthy(endpoint, checkContent = true) {
    if (unhealthyEndpoints.has(endpoint)) {
        console.log(`Skipping health check for known unhealthy endpoint: ${endpoint}`);
        return false;
    }

    const hostname = new URL(endpoint).hostname;
    if (!await isHostReachable(hostname)) {
        console.log(`Host ${hostname} is not reachable.`);
        unhealthyEndpoints.add(endpoint);
        return false;
    }

    try {
        const response = await retryFetchWithTimeout(endpoint, 1); // One retry attempt
        if (!response.ok) throw new Error(`Response not OK: ${response.statusText}`);

        if (checkContent) {
            const data = await response.json();
            const currentTime = new Date();
            const latestBlockTime = new Date(data.result?.sync_info?.latest_block_time || data.block?.header?.time);
            const timeDiff = Math.abs(currentTime - latestBlockTime) / 1000;

            if (timeDiff > 45) {
                console.log(`Endpoint ${endpoint} block time is too far from current time.`);
                unhealthyEndpoints.add(endpoint);
                return false;
            }
        }
    } catch (error) {
        console.error(`Error checking endpoint health for ${endpoint}: ${error}`);
        unhealthyEndpoints.add(endpoint);
        return false;
    }

    return true;
}

function fetchWithTimeout(url, timeout = 15000) {
    return Promise.race([
        fetch(url),
        new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), timeout)),
    ]);
}

async function retryFetchWithTimeout(url, retries = 1) {
    for (let attempt = 0; attempt <= retries; attempt++) {
        try {
            return await fetchWithTimeout(url);
        } catch (error) {
            if (error.message === 'timeout' && attempt < retries) {
                console.log(`Timeout encountered. Retrying fetch for: ${url}`);
            } else {
                throw error;
            }
        }
    }
}

function recoverEndpoint(endpoint) {
    unhealthyEndpoints.delete(endpoint);
}

function periodicallyCheckUnhealthyEndpoints(interval = 180000) { // Every 180 seconds
    setInterval(() => {
        unhealthyEndpoints.forEach(async (endpoint) => {
            if (await isEndpointHealthy(endpoint, false)) {
                console.log(`Endpoint recovered: ${endpoint}`);
                recoverEndpoint(endpoint);
            }
        });
    }, interval);
}

module.exports = {
    fetchWithTimeout,
    retryFetchWithTimeout,
    isHostReachable,
    isEndpointHealthy,
    recoverEndpoint,
    periodicallyCheckUnhealthyEndpoints,
};
