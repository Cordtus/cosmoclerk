mod bot;
mod cache;
mod commands;
mod handlers;
mod tests;
mod utils;

use anyhow::{bail, Context, Result};
use dotenv::dotenv;
use log::info;
use std::env;
use teloxide::prelude::*;

const DEFAULT_TELEGRAM_API_ROOT: &str = "https://api.telegram.org";

fn telegram_api_url(configured_root: Option<&str>) -> Result<reqwest::Url> {
    let configured_root = configured_root.unwrap_or(DEFAULT_TELEGRAM_API_ROOT);
    let mut url = reqwest::Url::parse(configured_root).context("invalid TELEGRAM_API_ROOT")?;

    if !matches!(url.scheme(), "http" | "https") {
        bail!(
            "TELEGRAM_API_ROOT must use http or https, got {:?}",
            url.scheme()
        );
    }

    if url.query().is_some() || url.fragment().is_some() {
        bail!("TELEGRAM_API_ROOT must not include a query or fragment");
    }

    if !url.path().trim_end_matches('/').is_empty() {
        bail!("TELEGRAM_API_ROOT must not include a path");
    }

    url.set_path("/");

    Ok(url)
}

#[tokio::main]
async fn main() -> Result<()> {
    dotenv().ok();
    env_logger::init();

    let bot_token = env::var("BOT_TOKEN").expect("BOT_TOKEN must be set");
    let configured_api_root = match env::var("TELEGRAM_API_ROOT") {
        Ok(root) => Some(root),
        Err(env::VarError::NotPresent) => None,
        Err(error) => return Err(error).context("TELEGRAM_API_ROOT must be valid Unicode"),
    };
    let api_url = telegram_api_url(configured_api_root.as_deref())?;

    info!("Starting CosmoClerk Rust bot...");

    let bot = Bot::new(bot_token).set_api_url(api_url);

    bot::run(bot)
        .await
        .map_err(|e| anyhow::anyhow!("Bot error: {}", e))?;

    Ok(())
}
