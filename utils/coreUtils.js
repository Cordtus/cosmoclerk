const dns = require('dns');
const fetch = require('node-fetch');

async function isHostReachable(host) {
    return new Promise((resolve) => {
        dns.lookup(host, (err) => {
            if (err && err.code === 'ENOTFOUND') {
                resolve(false);
            } else {
                resolve(true);
            }
        });
    });
}

async function isEndpointHealthy(url) {
    try {
        const urlObj = new URL(url);
        const host = urlObj.hostname;

        const reachable = await isHostReachable(host);
        if (!reachable) {
            return false;
        }

        const response = await fetch(url, { method: 'HEAD', timeout: 5000 });
        return response.ok;
    } catch (error) {
        console.error(`Failed to check health for endpoint: ${url}`, error);
        return false;
    }
}

async function findHealthyEndpoint(ctx, chainData, type) {
    console.log(`Checking health for endpoints of type: ${type}`);
    const endpoints = chainData.apis?.[type] || [];
    const healthChecks = endpoints.map(async (endpoint) => {
        const healthy = await isEndpointHealthy(endpoint.address);
        if (healthy) {
            console.log(`Healthy endpoint found: ${endpoint.address}`);
            return endpoint.address;
        }
        return null;
    });

    const results = await Promise.all(healthChecks);
    const healthyEndpoint = results.find((result) => result !== null);
    if (healthyEndpoint) {
        return healthyEndpoint;
    } else {
        console.warn(`No healthy endpoints found for type: ${type}`);
        return 'Unknown';
    }
}

function sanitizeUrl(url) {
    return url.replace(/[()]/g, '\\$&'); // Add more characters if needed for escaping
}

function sanitizeString(name) {
    if (typeof name !== 'string') {
        return name;
    }
    return name.replace(/[\u{1F600}-\u{1F64F}]/gu, '').replace(/[^\w\s]/g, '_');
}

function escapeMarkdown(url) {
    return url.replace(/[_]/g, '\\$&');
}

function findPreferredExplorer(explorers) {
    if (!explorers || explorers.length === 0) return "Unknown";

    function stripPrefixes(name) {
        return name.replace(/^(http:\/\/|https:\/\/)?(www\.)?/, '');
    }

    const preferredOrder = ['m', 'c'];

    const sortedExplorers = explorers.map(explorer => {
        return {
            kind: explorer.kind,
            url: explorer.url,
            compareUrl: stripPrefixes(explorer.url)
        };
    }).sort((a, b) => {
        for (const letter of preferredOrder) {
            if (a.compareUrl.startsWith(letter) && !b.compareUrl.startsWith(letter)) {
                return -1;
            }
            if (b.compareUrl.startsWith(letter) && !a.compareUrl.startsWith(letter)) {
                return 1;
            }
        }
        return a.compareUrl.localeCompare(b.compareUrl);
    });

    return sortedExplorers.length > 0 ? sortedExplorers[0].url : "Unknown";
}

module.exports = {
    isHostReachable,
    isEndpointHealthy,
    findHealthyEndpoint,
    sanitizeString,
    sanitizeUrl,
    escapeMarkdown,
    findPreferredExplorer
};
