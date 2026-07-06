# CosmoClerk Rust Version

A Rust implementation of the CosmoClerk Telegram bot using the [chain-registry-rust](https://github.com/Cordtus/chain-registry-rust) crate.

## Key Improvements Over JS Version

- **No Repository Cloning**: Fetches chain data on-demand instead of cloning the entire chain-registry repo
- **Built-in Caching**: 30-minute TTL cache reduces API calls and improves response times (~50µs cached vs ~500ms network)
- **Type Safety**: Rust's strong typing ensures data integrity
- **Lower Memory Footprint**: No need to store entire registry locally

## Features

Core bot features:

-  Chain selection with pagination
-  Chain info display (ID, name, RPC, REST, etc.)
-  Peer nodes listing
-  Endpoints display (RPC, REST, GRPC, EVM RPC where available)
-  Block explorers
-  gRPC-first IBC denomination lookup with REST fallback
-  gRPC-first IBC route lookup by channel with REST fallback
-  gRPC-first wallet balance lookup with IBC denom resolution
-  Polkachu node installation guide links for supported chains
-  Osmosis-specific features:
  - Pool info
  - LP incentive gauges and concentrated liquidity incentive records
  - Price info

## Setup

1. Create a `.env` file based on `.env.example`:
```bash
cp .env.example .env
# Edit .env and add your Telegram bot token
```

2. Build the project:
```bash
cargo build --release
```

3. Run the bot:
```bash
cargo run --release
```

## Development

```bash
# Run with debug logging
RUST_LOG=debug cargo run

# Run the full local pre-build gate
./scripts/check.sh

# Build with pre-build checks
./scripts/build.sh
```

## Architecture

- `src/main.rs` - Entry point
- `src/bot.rs` - Bot state machine and dialogue handling
- `src/handlers.rs` - Message and callback handlers
- `src/cache.rs` - Registry data caching layer
- `src/utils.rs` - gRPC, REST, IBC, Osmosis, and formatting helpers
- `src/commands.rs` - Bot command definitions

Direct Cosmos SDK queries prefer chain-registry gRPC endpoints, with Polkachu
endpoints tried first when present. REST/RPC is retained as fallback for chains
or modules where gRPC is unavailable.

Legacy JavaScript/TypeScript versions are archived on isolated branches. The active `main` line is the Rust rewrite and should stay free of Node package artifacts.

## Dependencies

- `teloxide` - Telegram bot framework
- `chain-registry` - Cosmos chain registry API
- `tokio` - Async runtime
- `reqwest` - HTTP client
- `dashmap` - Concurrent hashmap for caching

## Deployment

The compiled binary is self-contained and can be deployed anywhere. For the
standard systemd/LXC deployment used by this repo, keep the bot token in
`/etc/cosmoclerk/.env` on the target and run:

```bash
DEPLOY_TARGET=tgbot ./scripts/deploy.sh
```

`scripts/deploy.sh` builds the release binary, pushes it to
`/usr/local/bin/cosmoclerk`, installs `cosmoclerk.service`, restarts the service,
checks that it is active, and prints recent logs. It does not copy `.env` or any
secret material.

For a generic host, run `./scripts/build.sh` and copy
`target/release/cosmoclerk` plus `cosmoclerk.service` using your host's release
process.

## Docker

```dockerfile
FROM rust:1.75 as builder
WORKDIR /app
COPY . .
RUN cargo build --release

FROM debian:bookworm-slim
RUN apt-get update && apt-get install -y ca-certificates && rm -rf /var/lib/apt/lists/*
COPY --from=builder /app/target/release/cosmoclerk /usr/local/bin/
CMD ["cosmoclerk"]
```
