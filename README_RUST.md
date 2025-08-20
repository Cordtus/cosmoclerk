# CosmoClerk Rust Version

A Rust implementation of the CosmoClerk Telegram bot using the [chain-registry-rust](https://github.com/Cordtus/chain-registry-rust) crate.

## Key Improvements Over JS Version

- **No Repository Cloning**: Fetches chain data on-demand instead of cloning the entire chain-registry repo
- **Built-in Caching**: 30-minute TTL cache reduces API calls and improves response times (~50µs cached vs ~500ms network)
- **Type Safety**: Rust's strong typing ensures data integrity
- **Lower Memory Footprint**: No need to store entire registry locally
- **Better Performance**: Compiled Rust binary vs interpreted JavaScript

## Features

All features from the original JS version are supported:

- ✅ Chain selection with pagination
- ✅ Chain info display (ID, name, RPC, REST, etc.)
- ✅ Peer nodes listing
- ✅ Endpoints display (RPC, REST, GRPC)
- ✅ Block explorers
- ✅ IBC denomination lookup
- ✅ Osmosis-specific features:
  - Pool incentives
  - Pool info
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

# Check code
cargo check

# Run tests
cargo test

# Format code
cargo fmt
```

## Architecture

- `src/main.rs` - Entry point
- `src/bot.rs` - Bot state machine and dialogue handling
- `src/handlers.rs` - Message and callback handlers
- `src/cache.rs` - Registry data caching layer
- `src/utils.rs` - Helper functions
- `src/commands.rs` - Bot command definitions

## Dependencies

- `teloxide` - Telegram bot framework
- `chain-registry` - Cosmos chain registry API
- `tokio` - Async runtime
- `reqwest` - HTTP client
- `dashmap` - Concurrent hashmap for caching

## Deployment

The compiled binary is self-contained and can be deployed anywhere:

```bash
cargo build --release
cp target/release/cosmoclerk /path/to/deployment/
```

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