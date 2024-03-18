// config.js

const path = require('path');

const staleHours = parseInt(process.env.STALE_HOURS, 10) || 6;

const config = {
    pageSize: parseInt(process.env.PAGE_SIZE, 10) || 18,
    repoUrl: process.env.REPO_URL || "https://github.com/cosmos/chain-registry.git",
    repoDir: process.env.REPO_DIR || path.join(__dirname, 'chain-registry'),
    staleHours: staleHours,
    updateInterval: staleHours * 3600000,
};

module.exports = config;

