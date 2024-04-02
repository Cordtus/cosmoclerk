// config.js

require('dotenv').config();

const path = require('path');

const staleHours = parseInt(process.env.STALE_HOURS, 10) || 6; // stale hours threshold.

const config = {
    pageSize: parseInt(process.env.PAGE_SIZE, 10) || 18,
    repoUrl: process.env.REPO_URL || "https://github.com/cosmos/chain-registry.git",
    repoDir: path.join(__dirname, "data", "repo", "chain-registry"), // Changed to absolute path
    staleHours: staleHours,
    updateInterval: staleHours * 3600000, // Convert hours to milliseconds
};

module.exports = config;
