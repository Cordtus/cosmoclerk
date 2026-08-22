# Repository Guidelines

## Project Structure & Module Organization
CosmoClerk is a Rust 2021 Telegram bot for Cosmos chain-registry lookups. Source lives in `src/`: `main.rs` loads `.env` and starts the bot, `bot.rs` owns the Teloxide dialogue state machine, `handlers.rs` contains message/callback flows, `cache.rs` wraps chain data with a 30-minute TTL, `utils.rs` holds gRPC/HTTP/IBC/Osmosis helpers, and `commands.rs` defines slash commands. Tests currently live in `src/tests.rs`. `README_RUST.md` documents setup, and `cosmoclerk.service` is the systemd deployment example. Legacy JS/TS code belongs only on isolated archive branches; keep Node package artifacts out of the Rust branch.

## Build, Test, and Development Commands
- `cp .env.example .env` then set `BOT_TOKEN` before running locally.
- `./scripts/check.sh` runs the local pre-build gate: `cargo fmt -- --check`, `cargo check`, `cargo clippy --all-targets -- -D warnings`, and `cargo test`.
- `./scripts/build.sh` runs the pre-build gate, then creates `target/release/cosmoclerk`.
- `./scripts/build.sh --skip-checks` creates the release binary after checks have already passed.
- `DEPLOY_TARGET=tgbot ./scripts/deploy.sh` builds, installs the binary and systemd unit into the LXC target, restarts the service, and prints recent logs.
- `cargo check` validates Rust types quickly when a narrower loop is useful.
- `RUST_LOG=debug cargo run` starts the bot with verbose logging.
- `cargo test` runs the async unit tests in `src/tests.rs`.
- `cargo fmt -- --check` and `cargo clippy --all-targets -- -D warnings` are the preferred pre-PR style and lint gates.

## Coding Style & Naming Conventions
Follow rustfmt defaults with 4-space indentation. Use `snake_case` for functions, modules, variables, and tests; use `CamelCase` for types, enum variants, and structs. Keep async I/O on Tokio; avoid blocking calls in handlers or dispatcher paths. Reuse existing helpers for MarkdownV2 escaping, endpoint fallback, cache access, and callback data parsing before adding new utilities.

## Testing Guidelines
Use `#[tokio::test]` for async behavior. Name tests `test_<behavior>` and prefer deterministic tests for state transitions, callback parsing, chain filtering, keyboard layout, and formatter helpers. Avoid tests that require a real Telegram token or live chain endpoint unless isolated behind explicit setup notes.

## Commit & Pull Request Guidelines
Recent history uses short, lower-case imperative subjects, for example `add wallet balance check feature for mainnets` and `fix testnet listing and add ABCI info to chain details`. PR descriptions should explain user-visible bot changes, list verification commands, and note any `.env.example`, systemd, or deployment impact. Include screenshots or Telegram transcript snippets for UI/menu changes when practical.

## Security & Configuration Tips
Never commit real bot tokens or chat/user identifiers. Keep local secrets in untracked `.env`; update `.env.example` only for safe variable names/defaults.
