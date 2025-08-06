# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

CosmoClerk is a Telegram bot that serves as a wrapper for the Cosmos Chain-Registry, providing users with easy access to blockchain information across the Cosmos ecosystem.

## Key Commands

```bash
# Install dependencies
yarn install

# Run the bot
node main.js

# The bot requires BOT_TOKEN to be set in .env file
```

## Architecture & Structure

### Core Implementation (main.js)
The entire application is contained in a single `main.js` file (1376 lines) that implements:

1. **Bot Initialization**: Uses Telegraf library with token from environment
2. **Chain Registry Management**: 
   - Clones/updates cosmos/chain-registry repository on startup
   - Refreshes data every 24 hours
   - Parses chain and asset JSON files dynamically
3. **State Management**: Uses in-memory maps to track user sessions and pagination
4. **Feature Modules**: 
   - Chain information display (RPC/REST endpoints, explorers, peers)
   - IBC denomination translation
   - Osmosis-specific features (pools, incentives, prices)

### Key Technical Patterns

- **Paginated Navigation**: Chain selection uses inline keyboards with pagination (12 chains per page)
- **Dynamic Data Loading**: Chain and asset data loaded from filesystem on each request
- **Health Checking**: Tests endpoint availability before displaying to users
- **Session Management**: Tracks user selections in memory using Maps

### External Dependencies

- **telegraf**: Telegram bot framework
- **simple-git**: For managing chain-registry repository updates
- **node-fetch**: For making HTTP requests to blockchain endpoints

### Important Behaviors

- Bot responds to direct chain name inputs or menu navigation
- `/start` and `/restart` commands reset user session
- Handles both mainnet and testnet chains
- Special handling for Osmosis chain features (pools, IBC assets)
- Endpoint health is verified before displaying to ensure users get working endpoints

## Development Notes

- No test suite currently exists
- No build process - runs directly via Node.js
- Configuration via environment variables only (BOT_TOKEN required)
- Chain registry data stored in `chain-registry/` directory (auto-managed)