// config.js

require('dotenv').config();

const path = require('path');

const staleHours = parseInt(process.env.STALE_HOURS, 10) || 6; // Stale hours threshold.

const config = {
    pageSize: parseInt(process.env.PAGE_SIZE, 10) || 18,
    repoUrl: process.env.REPO_URL || "https://github.com/cosmos/chain-registry.git",
    repoDir: path.join(__dirname, "data", "repo", "chain-registry"), // Absolute path to the chain-registry directory
    staleHours: staleHours,
    updateInterval: staleHours * 3600000, // Convert hours to milliseconds for update interval
    sessionExpirationThreshold: parseInt(process.env.SESSION_EXPIRATION_THRESHOLD, 10) || 3600000, // 1 hour default for session expiration
    cleanupInterval: parseInt(process.env.CLEANUP_INTERVAL, 10) || 600000, // 10 minutes default for cleanup interval
};

module.exports = config;
