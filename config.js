// config.js

const path = require('path');

const config = {
    pageSize: parseInt(process.env.PAGE_SIZE, 10) || 18,
    repoUrl: process.env.REPO_URL || "https://github.com/cosmos/chain-registry.git",
    repoDir: path.join(__dirname, "data", "repo", "chain-registry"),
    staleHours: parseInt(process.env.STALE_HOURS, 10) || 6,
    updateInterval: parseInt(process.env.STALE_HOURS, 10) || 6 * 3600000, // Convert hours to milliseconds
    sessionExpirationThreshold: parseInt(process.env.SESSION_EXPIRATION_THRESHOLD, 10) || 3600000, // 1 hour
    cleanupInterval: parseInt(process.env.CLEANUP_INTERVAL, 10) || 600000, // 10 minutes
    dnsTimeout: parseInt(process.env.DNS_TIMEOUT, 10) || 2000, // DNS lookup timeout in milliseconds
    fetchTimeout: parseInt(process.env.FETCH_TIMEOUT, 10) || 12000, // Fetch timeout in milliseconds
};

module.exports = config;
