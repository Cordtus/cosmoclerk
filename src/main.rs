mod bot;
mod cache;
mod commands;
mod handlers;
mod utils;
mod tests;

use anyhow::Result;
use dotenv::dotenv;
use log::info;
use std::env;
use teloxide::prelude::*;

#[tokio::main]
async fn main() -> Result<()> {
    dotenv().ok();
    env_logger::init();

    let bot_token = env::var("BOT_TOKEN").expect("BOT_TOKEN must be set");
    
    info!("Starting CosmoClerk Rust bot...");
    
    let bot = Bot::new(bot_token);
    
    bot::run(bot).await.map_err(|e| anyhow::anyhow!("Bot error: {}", e))?;
    
    Ok(())
}