use crate::{
    bot::{MyDialogue, PoolAction, State},
    cache::RegistryCache,
    commands::Command,
    utils::{escape_markdown, find_healthy_endpoint, find_healthy_rest_endpoint, query_ibc_denom, PAGE_SIZE},
};
use std::sync::Arc;
use teloxide::{
    prelude::*,
    types::{InlineKeyboardButton, InlineKeyboardMarkup, ParseMode},
};

pub async fn start(
    bot: Bot,
    dialogue: MyDialogue,
    msg: Message,
) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    dialogue.update(State::SelectingChain { page: 0, is_testnet: false }).await?;
    show_chain_selection(&bot, &msg, 0, false).await?;
    Ok(())
}

pub async fn restart(
    bot: Bot,
    dialogue: MyDialogue,
    msg: Message,
) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    dialogue.reset().await?;
    start(bot, dialogue, msg).await
}

pub async fn help(
    bot: Bot,
    msg: Message,
) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    bot.send_message(
        msg.chat.id,
        "CosmoClerk Bot - Cosmos Chain Registry Explorer\n\n\
        Commands:\n\
        /start - Start the bot\n\
        /restart - Clear session and restart\n\
        /help - Show this message\n\n\
        You can also type a chain name directly to select it.",
    )
    .await?;
    Ok(())
}

async fn show_chain_selection(
    bot: &Bot,
    msg: &Message,
    page: usize,
    is_testnet: bool,
) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    let cache = RegistryCache::new(30);
    let chains = cache.list_chains().await?;
    
    let filtered_chains: Vec<String> = if is_testnet {
        chains.into_iter().filter(|c| c.contains("testnet")).collect()
    } else {
        chains.into_iter().filter(|c| !c.contains("testnet")).collect()
    };

    let total_pages = (filtered_chains.len() + PAGE_SIZE - 1) / PAGE_SIZE;
    let start = page * PAGE_SIZE;
    let end = (start + PAGE_SIZE).min(filtered_chains.len());
    
    let page_chains = &filtered_chains[start..end];
    
    let mut buttons = vec![];
    for chunk in page_chains.chunks(3) {
        let row: Vec<InlineKeyboardButton> = chunk
            .iter()
            .map(|chain| InlineKeyboardButton::callback(chain, format!("select:{}", chain)))
            .collect();
        buttons.push(row);
    }
    
    // Navigation buttons
    let mut nav_buttons = vec![];
    if page > 0 {
        nav_buttons.push(InlineKeyboardButton::callback("← Previous", format!("page:{}", page - 1)));
    }
    if page < total_pages - 1 {
        nav_buttons.push(InlineKeyboardButton::callback("Next →", format!("page:{}", page + 1)));
    }
    if !nav_buttons.is_empty() {
        buttons.push(nav_buttons);
    }
    
    // Testnet toggle
    buttons.push(vec![InlineKeyboardButton::callback(
        if is_testnet { "Show Mainnets" } else { "Show Testnets" },
        format!("toggle_testnet:{}", !is_testnet),
    )]);
    
    let keyboard = InlineKeyboardMarkup::new(buttons);
    
    bot.send_message(
        msg.chat.id,
        if is_testnet { "Select a testnet:" } else { "Select a chain:" },
    )
    .reply_markup(keyboard)
    .await?;
    
    Ok(())
}

pub async fn handle_chain_selection(
    bot: Bot,
    dialogue: MyDialogue,
    cache: Arc<RegistryCache>,
    q: CallbackQuery,
    (page, is_testnet): (usize, bool),
) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    if let Some(data) = q.data {
        if data.starts_with("select:") {
            let chain = data.strip_prefix("select:").unwrap().to_string();
            dialogue.update(State::ChainSelected { chain: chain.clone() }).await?;
            show_chain_menu(&bot, &q, &chain).await?;
        } else if data.starts_with("page:") {
            let new_page: usize = data.strip_prefix("page:").unwrap().parse()?;
            dialogue.update(State::SelectingChain { page: new_page, is_testnet }).await?;
            update_chain_selection(&bot, &q, new_page, is_testnet).await?;
        } else if data.starts_with("toggle_testnet:") {
            let new_testnet: bool = data.strip_prefix("toggle_testnet:").unwrap().parse()?;
            dialogue.update(State::SelectingChain { page: 0, is_testnet: new_testnet }).await?;
            update_chain_selection(&bot, &q, 0, new_testnet).await?;
        }
    }
    
    bot.answer_callback_query(q.id).await?;
    Ok(())
}

async fn update_chain_selection(
    bot: &Bot,
    q: &CallbackQuery,
    page: usize,
    is_testnet: bool,
) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    let cache = RegistryCache::new(30);
    let chains = cache.list_chains().await?;
    
    let filtered_chains: Vec<String> = if is_testnet {
        chains.into_iter().filter(|c| c.contains("testnet")).collect()
    } else {
        chains.into_iter().filter(|c| !c.contains("testnet")).collect()
    };

    let total_pages = (filtered_chains.len() + PAGE_SIZE - 1) / PAGE_SIZE;
    let start = page * PAGE_SIZE;
    let end = (start + PAGE_SIZE).min(filtered_chains.len());
    
    let page_chains = &filtered_chains[start..end];
    
    let mut buttons = vec![];
    for chunk in page_chains.chunks(3) {
        let row: Vec<InlineKeyboardButton> = chunk
            .iter()
            .map(|chain| InlineKeyboardButton::callback(chain, format!("select:{}", chain)))
            .collect();
        buttons.push(row);
    }
    
    // Navigation buttons
    let mut nav_buttons = vec![];
    if page > 0 {
        nav_buttons.push(InlineKeyboardButton::callback("← Previous", format!("page:{}", page - 1)));
    }
    if page < total_pages - 1 {
        nav_buttons.push(InlineKeyboardButton::callback("Next →", format!("page:{}", page + 1)));
    }
    if !nav_buttons.is_empty() {
        buttons.push(nav_buttons);
    }
    
    // Testnet toggle
    buttons.push(vec![InlineKeyboardButton::callback(
        if is_testnet { "Show Mainnets" } else { "Show Testnets" },
        format!("toggle_testnet:{}", !is_testnet),
    )]);
    
    let keyboard = InlineKeyboardMarkup::new(buttons);
    
    if let Some(Message { id, chat, .. }) = q.message {
        bot.edit_message_text(
            chat.id,
            id,
            if is_testnet { "Select a testnet:" } else { "Select a chain:" },
        )
        .reply_markup(keyboard)
        .await?;
    }
    
    Ok(())
}

async fn show_chain_menu(
    bot: &Bot,
    q: &CallbackQuery,
    chain: &str,
) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    let mut buttons = vec![
        vec![
            InlineKeyboardButton::callback("1. Chain Info", "action:chain_info"),
            InlineKeyboardButton::callback("2. Peer Nodes", "action:peer_nodes"),
        ],
        vec![
            InlineKeyboardButton::callback("3. Endpoints", "action:endpoints"),
            InlineKeyboardButton::callback("4. Block Explorers", "action:explorers"),
        ],
    ];
    
    // Add IBC and Osmosis-specific options
    if !chain.contains("testnet") {
        buttons.push(vec![InlineKeyboardButton::callback("5. IBC-ID", "action:ibc_id")]);
        
        if chain == "osmosis" {
            buttons.push(vec![
                InlineKeyboardButton::callback("6. LP Incentives", "action:pool_incentives"),
                InlineKeyboardButton::callback("7. Pool Info", "action:pool_info"),
            ]);
            buttons.push(vec![InlineKeyboardButton::callback("8. Price Info", "action:price_info")]);
        }
    }
    
    buttons.push(vec![InlineKeyboardButton::callback("← Back", "back:chains")]);
    
    let keyboard = InlineKeyboardMarkup::new(buttons);
    
    if let Some(Message { id, chat, .. }) = q.message {
        bot.edit_message_text(chat.id, id, format!("Selected: {}\n\nChoose an action:", chain))
            .reply_markup(keyboard)
            .await?;
    }
    
    Ok(())
}

pub async fn handle_chain_action(
    bot: Bot,
    dialogue: MyDialogue,
    cache: Arc<RegistryCache>,
    q: CallbackQuery,
    chain: String,
) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    if let Some(data) = q.data {
        match data.as_str() {
            "action:chain_info" => show_chain_info(&bot, &q, &cache, &chain).await?,
            "action:peer_nodes" => show_peer_nodes(&bot, &q, &cache, &chain).await?,
            "action:endpoints" => show_endpoints(&bot, &q, &cache, &chain).await?,
            "action:explorers" => show_explorers(&bot, &q, &cache, &chain).await?,
            "action:ibc_id" => {
                dialogue.update(State::AwaitingIbcDenom { chain }).await?;
                if let Some(Message { chat, .. }) = q.message {
                    bot.send_message(chat.id, "Enter IBC denom (e.g., ibc/ABC123...):")
                        .await?;
                }
            }
            "action:pool_incentives" => {
                dialogue.update(State::AwaitingPoolId { 
                    chain, 
                    action: PoolAction::Incentives 
                }).await?;
                if let Some(Message { chat, .. }) = q.message {
                    bot.send_message(chat.id, "Enter pool ID:").await?;
                }
            }
            "action:pool_info" => {
                dialogue.update(State::AwaitingPoolId { 
                    chain, 
                    action: PoolAction::Info 
                }).await?;
                if let Some(Message { chat, .. }) = q.message {
                    bot.send_message(chat.id, "Enter pool ID:").await?;
                }
            }
            "action:price_info" => {
                dialogue.update(State::AwaitingTokenTicker { chain }).await?;
                if let Some(Message { chat, .. }) = q.message {
                    bot.send_message(chat.id, "Enter token ticker (e.g., OSMO):").await?;
                }
            }
            "back:chains" => {
                dialogue.update(State::SelectingChain { page: 0, is_testnet: false }).await?;
                update_chain_selection(&bot, &q, 0, false).await?;
            }
            _ => {}
        }
    }
    
    bot.answer_callback_query(q.id).await?;
    Ok(())
}

async fn show_chain_info(
    bot: &Bot,
    q: &CallbackQuery,
    cache: &Arc<RegistryCache>,
    chain: &str,
) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    let chain_data = cache.get_chain(chain).await?;
    let assets_data = cache.get_assets(chain).await?;
    
    if let (Some(chain_info), Some(assets)) = (chain_data, assets_data) {
        let base_denom = chain_info
            .staking
            .staking_tokens
            .first()
            .map(|t| t.denom.as_str())
            .unwrap_or("Unknown");
        
        let decimals = assets
            .assets
            .first()
            .and_then(|a| a.denom_units.last())
            .map(|d| d.exponent.to_string())
            .unwrap_or_else(|| "Unknown".to_string());
        
        let rpc = find_healthy_endpoint(&chain_info.apis.rpc, true)
            .await
            .unwrap_or_else(|| "Unknown".to_string());
        
        let rest = find_healthy_rest_endpoint(&chain_info.apis.rest)
            .await
            .unwrap_or_else(|| "Unknown".to_string());
        
        let explorer = chain_info
            .explorers
            .first()
            .map(|e| e.url.as_str())
            .unwrap_or("Unknown");
        
        let message = format!(
            "🔗 *{}*\n\n\
            Chain ID: `{}`\n\
            Chain Name: `{}`\n\
            RPC: `{}`\n\
            REST: `{}`\n\
            Address Prefix: `{}`\n\
            Base Denom: `{}`\n\
            Cointype: `{}`\n\
            Decimals: `{}`\n\
            Block Explorer: `{}`",
            escape_markdown(&chain_info.pretty_name),
            escape_markdown(&chain_info.chain_id),
            escape_markdown(&chain_info.chain_name),
            escape_markdown(&rpc),
            escape_markdown(&rest),
            escape_markdown(&chain_info.bech32_prefix),
            escape_markdown(base_denom),
            chain_info.slip44,
            decimals,
            escape_markdown(explorer)
        );
        
        if let Some(Message { id, chat, .. }) = q.message {
            bot.edit_message_text(chat.id, id, message)
                .parse_mode(ParseMode::MarkdownV2)
                .await?;
        }
    } else {
        if let Some(Message { chat, .. }) = q.message {
            bot.send_message(chat.id, format!("Chain {} not found", chain))
                .await?;
        }
    }
    
    Ok(())
}

async fn show_peer_nodes(
    bot: &Bot,
    q: &CallbackQuery,
    cache: &Arc<RegistryCache>,
    chain: &str,
) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    let chain_data = cache.get_chain(chain).await?;
    
    if let Some(chain_info) = chain_data {
        let mut message = String::from("*Seed Nodes*\n\\-\\-\\-\\-\\-\\-\\-\\-\\-\\-\n");
        
        for seed in chain_info.peers.seeds.iter().take(5) {
            let provider = seed.provider.as_deref().unwrap_or("unknown");
            message.push_str(&format!(
                "*{}*:\nid: `{}`\nURL: `{}`\n\n",
                escape_markdown(provider),
                escape_markdown(&seed.id),
                escape_markdown(&seed.address)
            ));
        }
        
        message.push_str("\n*Persistent Peers*\n\\-\\-\\-\\-\\-\\-\\-\\-\\-\\-\\-\\-\\-\\-\\-\n");
        
        for peer in chain_info.peers.persistent_peers.iter().take(5) {
            message.push_str(&format!(
                "id: `{}`\nURL: `{}`\n\n",
                escape_markdown(&peer.id),
                escape_markdown(&peer.address)
            ));
        }
        
        if let Some(Message { id, chat, .. }) = q.message {
            bot.edit_message_text(chat.id, id, message)
                .parse_mode(ParseMode::MarkdownV2)
                .await?;
        }
    } else {
        if let Some(Message { chat, .. }) = q.message {
            bot.send_message(chat.id, format!("Chain {} not found", chain))
                .await?;
        }
    }
    
    Ok(())
}

async fn show_endpoints(
    bot: &Bot,
    q: &CallbackQuery,
    cache: &Arc<RegistryCache>,
    chain: &str,
) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    let chain_data = cache.get_chain(chain).await?;
    
    if let Some(chain_info) = chain_data {
        let mut message = String::from("*RPC*\n\\-\\-\\-\n");
        
        for rpc in chain_info.apis.rpc.iter().take(5) {
            let provider = rpc.provider.as_deref().unwrap_or("unknown");
            message.push_str(&format!(
                "*{}*:\n`{}`\n\n",
                escape_markdown(provider),
                escape_markdown(&rpc.address)
            ));
        }
        
        message.push_str("\n*REST*\n\\-\\-\\-\\-\n");
        
        for rest in chain_info.apis.rest.iter().take(5) {
            let provider = rest.provider.as_deref().unwrap_or("unknown");
            message.push_str(&format!(
                "*{}*:\n`{}`\n\n",
                escape_markdown(provider),
                escape_markdown(&rest.address)
            ));
        }
        
        message.push_str("\n*GRPC*\n\\-\\-\\-\\-\n");
        
        for grpc in chain_info.apis.grpc.iter().take(5) {
            let provider = grpc.provider.as_deref().unwrap_or("unknown");
            message.push_str(&format!(
                "*{}*:\n`{}`\n\n",
                escape_markdown(provider),
                escape_markdown(&grpc.address)
            ));
        }
        
        if let Some(Message { id, chat, .. }) = q.message {
            bot.edit_message_text(chat.id, id, message)
                .parse_mode(ParseMode::MarkdownV2)
                .await?;
        }
    } else {
        if let Some(Message { chat, .. }) = q.message {
            bot.send_message(chat.id, format!("Chain {} not found", chain))
                .await?;
        }
    }
    
    Ok(())
}

async fn show_explorers(
    bot: &Bot,
    q: &CallbackQuery,
    cache: &Arc<RegistryCache>,
    chain: &str,
) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    let chain_data = cache.get_chain(chain).await?;
    
    if let Some(chain_info) = chain_data {
        let mut message = String::from("*Block Explorers*\n\\-\\-\\-\\-\\-\\-\\-\\-\\-\\-\\-\\-\\-\\-\\-\n\n");
        
        for explorer in &chain_info.explorers {
            message.push_str(&format!(
                "*{}*:\n`{}`\n\n",
                escape_markdown(&explorer.kind),
                escape_markdown(&explorer.url)
            ));
        }
        
        if let Some(Message { id, chat, .. }) = q.message {
            bot.edit_message_text(chat.id, id, message)
                .parse_mode(ParseMode::MarkdownV2)
                .await?;
        }
    } else {
        if let Some(Message { chat, .. }) = q.message {
            bot.send_message(chat.id, format!("Chain {} not found", chain))
                .await?;
        }
    }
    
    Ok(())
}

pub async fn handle_ibc_denom(
    bot: Bot,
    dialogue: MyDialogue,
    cache: Arc<RegistryCache>,
    msg: Message,
    chain: String,
) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    if let Some(text) = msg.text() {
        if text.starts_with("ibc/") {
            let ibc_hash = text.strip_prefix("ibc/").unwrap();
            
            // Get chain info to find REST endpoint
            if let Some(chain_info) = cache.get_chain(&chain).await? {
                if let Some(rest) = find_healthy_rest_endpoint(&chain_info.apis.rest).await {
                    match query_ibc_denom(&rest, ibc_hash).await {
                        Ok((path, base_denom)) => {
                            let message = if !path.is_empty() {
                                format!("Path: {}\nBase Denomination: {}", path, base_denom)
                            } else {
                                format!("Base Denomination: {}", base_denom)
                            };
                            bot.send_message(msg.chat.id, message).await?;
                        }
                        Err(_) => {
                            bot.send_message(msg.chat.id, "Failed to fetch IBC denom trace")
                                .await?;
                        }
                    }
                } else {
                    bot.send_message(msg.chat.id, "No healthy REST endpoint found for this chain")
                        .await?;
                }
            } else {
                bot.send_message(msg.chat.id, "Chain not found").await?;
            }
        } else {
            bot.send_message(msg.chat.id, "Please enter a valid IBC denom (e.g., ibc/ABC123...)")
                .await?;
        }
    }
    
    dialogue.update(State::ChainSelected { chain }).await?;
    Ok(())
}

pub async fn handle_pool_id(
    bot: Bot,
    dialogue: MyDialogue,
    cache: Arc<RegistryCache>,
    msg: Message,
    (chain, action): (String, PoolAction),
) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    if let Some(text) = msg.text() {
        if let Ok(pool_id) = text.parse::<u64>() {
            match action {
                PoolAction::Incentives => {
                    handle_pool_incentives(&bot, &msg, &cache, &chain, pool_id).await?;
                }
                PoolAction::Info => {
                    handle_pool_info(&bot, &msg, &cache, &chain, pool_id).await?;
                }
            }
        } else {
            bot.send_message(msg.chat.id, "Please enter a valid pool ID number")
                .await?;
        }
    }
    
    dialogue.update(State::ChainSelected { chain }).await?;
    Ok(())
}

async fn handle_pool_incentives(
    bot: &Bot,
    msg: &Message,
    cache: &Arc<RegistryCache>,
    chain: &str,
    pool_id: u64,
) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    if let Some(chain_info) = cache.get_chain(chain).await? {
        if let Some(rest) = find_healthy_rest_endpoint(&chain_info.apis.rest).await {
            // Check pool type first
            let pool_type_url = format!("{}/osmosis/gamm/v1beta1/pools/{}", rest.trim_end_matches('/'), pool_id);
            
            match reqwest::get(&pool_type_url).await {
                Ok(response) if response.status().is_success() => {
                    let json: serde_json::Value = response.json().await?;
                    let pool_type = json["pool"]["@type"].as_str().unwrap_or("");
                    
                    if pool_type.contains("concentratedliquidity") {
                        // Handle concentrated liquidity pool
                        let url = format!(
                            "{}/osmosis/concentratedliquidity/v1beta1/incentive_records?pool_id={}",
                            rest.trim_end_matches('/'),
                            pool_id
                        );
                        
                        match reqwest::get(&url).await {
                            Ok(resp) if resp.status().is_success() => {
                                let data: serde_json::Value = resp.json().await?;
                                if let Some(records) = data["incentive_records"].as_array() {
                                    if !records.is_empty() {
                                        let mut message = format!("Pool {} Incentives:\n\n", pool_id);
                                        for record in records.iter().take(5) {
                                            if let Some(body) = record["incentive_record_body"].as_object() {
                                                let denom = body["remaining_coin"]["denom"].as_str().unwrap_or("unknown");
                                                let amount = body["remaining_coin"]["amount"].as_str().unwrap_or("0");
                                                let rate = body["emission_rate"].as_str().unwrap_or("0");
                                                message.push_str(&format!("Token: {}\nRemaining: {}\nRate: {}/s\n\n", denom, amount, rate));
                                            }
                                        }
                                        bot.send_message(msg.chat.id, message).await?;
                                    } else {
                                        bot.send_message(msg.chat.id, "No incentives found for this pool").await?;
                                    }
                                } else {
                                    bot.send_message(msg.chat.id, "No incentives data available").await?;
                                }
                            }
                            _ => {
                                bot.send_message(msg.chat.id, "Failed to fetch incentives data").await?;
                            }
                        }
                    } else {
                        // For GAMM pools, try the external API
                        let url = format!("http://jasbanza.dedicated.co.za:7000/pool/{}", pool_id);
                        match reqwest::get(&url).await {
                            Ok(resp) if resp.status().is_success() => {
                                let text = resp.text().await?;
                                // Parse the HTML response to extract JSON
                                if let Some(start) = text.find("<pre>") {
                                    if let Some(end) = text.find("</pre>") {
                                        let json_str = &text[start + 5..end];
                                        if let Ok(data) = serde_json::from_str::<serde_json::Value>(json_str) {
                                            if let Some(incentives) = data["data"].as_array() {
                                                let mut message = format!("Pool {} Incentives:\n\n", pool_id);
                                                for incentive in incentives.iter().take(3) {
                                                    if let Some(coins) = incentive["coins"].as_array() {
                                                        for coin in coins {
                                                            let denom = coin["denom"].as_str().unwrap_or("unknown");
                                                            let amount = coin["amount"].as_str().unwrap_or("0");
                                                            message.push_str(&format!("Token: {}\nAmount: {}\n", denom, amount));
                                                        }
                                                    }
                                                }
                                                bot.send_message(msg.chat.id, message).await?;
                                            } else {
                                                bot.send_message(msg.chat.id, "No incentives found").await?;
                                            }
                                        } else {
                                            bot.send_message(msg.chat.id, "Failed to parse incentives data").await?;
                                        }
                                    }
                                } else {
                                    bot.send_message(msg.chat.id, "Invalid response format").await?;
                                }
                            }
                            _ => {
                                bot.send_message(msg.chat.id, "Failed to fetch pool incentives").await?;
                            }
                        }
                    }
                }
                _ => {
                    bot.send_message(msg.chat.id, "Failed to fetch pool information").await?;
                }
            }
        } else {
            bot.send_message(msg.chat.id, "No healthy REST endpoint found").await?;
        }
    } else {
        bot.send_message(msg.chat.id, "Chain not found").await?;
    }
    
    Ok(())
}

async fn handle_pool_info(
    bot: &Bot,
    msg: &Message,
    cache: &Arc<RegistryCache>,
    chain: &str,
    pool_id: u64,
) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    if let Some(chain_info) = cache.get_chain(chain).await? {
        if let Some(rest) = find_healthy_rest_endpoint(&chain_info.apis.rest).await {
            let url = format!("{}/osmosis/gamm/v1beta1/pools/{}", rest.trim_end_matches('/'), pool_id);
            
            match reqwest::get(&url).await {
                Ok(response) if response.status().is_success() => {
                    let json: serde_json::Value = response.json().await?;
                    let pool = &json["pool"];
                    let pool_type = pool["@type"].as_str().unwrap_or("");
                    
                    let mut message = format!("Pool {} Info:\n\n", pool_id);
                    
                    if pool_type.contains("gamm") || pool_type.contains("stableswap") {
                        message.push_str("Type: GAMM Pool\n");
                        message.push_str(&format!("ID: {}\n", pool["id"].as_str().unwrap_or("")));
                        message.push_str(&format!("Address: {}\n", pool["address"].as_str().unwrap_or("")));
                        
                        if let Some(params) = pool["pool_params"].as_object() {
                            message.push_str(&format!("Swap Fee: {}\n", params["swap_fee"].as_str().unwrap_or("")));
                            message.push_str(&format!("Exit Fee: {}\n", params["exit_fee"].as_str().unwrap_or("")));
                        }
                        
                        if let Some(assets) = pool["pool_assets"].as_array() {
                            message.push_str("\nAssets:\n");
                            for asset in assets {
                                if let Some(token) = asset["token"].as_object() {
                                    let denom = token["denom"].as_str().unwrap_or("");
                                    let amount = token["amount"].as_str().unwrap_or("");
                                    message.push_str(&format!("- {}: {}\n", denom, amount));
                                }
                            }
                        }
                    } else if pool_type.contains("concentratedliquidity") {
                        message.push_str("Type: Concentrated Liquidity Pool\n");
                        message.push_str(&format!("ID: {}\n", pool["id"].as_str().unwrap_or("")));
                        message.push_str(&format!("Address: {}\n", pool["address"].as_str().unwrap_or("")));
                        message.push_str(&format!("Spread Factor: {}\n", pool["spread_factor"].as_str().unwrap_or("")));
                        message.push_str(&format!("Token0: {}\n", pool["token0"].as_str().unwrap_or("")));
                        message.push_str(&format!("Token1: {}\n", pool["token1"].as_str().unwrap_or("")));
                    }
                    
                    bot.send_message(msg.chat.id, message).await?;
                }
                _ => {
                    bot.send_message(msg.chat.id, "Failed to fetch pool information").await?;
                }
            }
        } else {
            bot.send_message(msg.chat.id, "No healthy REST endpoint found").await?;
        }
    } else {
        bot.send_message(msg.chat.id, "Chain not found").await?;
    }
    
    Ok(())
}

pub async fn handle_token_ticker(
    bot: Bot,
    dialogue: MyDialogue,
    cache: Arc<RegistryCache>,
    msg: Message,
    chain: String,
) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    if let Some(ticker) = msg.text() {
        let url = format!("https://api.osmosis.zone/tokens/v2/price/{}", ticker.to_uppercase());
        
        match reqwest::get(&url).await {
            Ok(response) if response.status().is_success() => {
                let json: serde_json::Value = response.json().await?;
                let price = json["price"].as_f64().unwrap_or(0.0);
                let change = json["24h_change"].as_f64().unwrap_or(0.0);
                
                let message = format!(
                    "Token: {}\nPrice: ${:.4}\n24h Change: {:.2}%",
                    ticker.to_uppercase(),
                    price,
                    change
                );
                
                bot.send_message(msg.chat.id, message).await?;
            }
            _ => {
                bot.send_message(msg.chat.id, "Failed to fetch price information").await?;
            }
        }
    }
    
    dialogue.update(State::ChainSelected { chain }).await?;
    Ok(())
}

pub async fn handle_text(
    bot: Bot,
    dialogue: MyDialogue,
    cache: Arc<RegistryCache>,
    msg: Message,
) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    if let Some(text) = msg.text() {
        let text_lower = text.to_lowercase();
        
        // Check if it's a chain name
        let chains = cache.list_chains().await?;
        if chains.iter().any(|c| c.to_lowercase() == text_lower) {
            dialogue.update(State::ChainSelected { chain: text_lower.clone() }).await?;
            
            // Show chain menu inline
            let mut buttons = vec![
                vec![
                    InlineKeyboardButton::callback("1. Chain Info", "action:chain_info"),
                    InlineKeyboardButton::callback("2. Peer Nodes", "action:peer_nodes"),
                ],
                vec![
                    InlineKeyboardButton::callback("3. Endpoints", "action:endpoints"),
                    InlineKeyboardButton::callback("4. Block Explorers", "action:explorers"),
                ],
            ];
            
            if !text_lower.contains("testnet") {
                buttons.push(vec![InlineKeyboardButton::callback("5. IBC-ID", "action:ibc_id")]);
                
                if text_lower == "osmosis" {
                    buttons.push(vec![
                        InlineKeyboardButton::callback("6. LP Incentives", "action:pool_incentives"),
                        InlineKeyboardButton::callback("7. Pool Info", "action:pool_info"),
                    ]);
                    buttons.push(vec![InlineKeyboardButton::callback("8. Price Info", "action:price_info")]);
                }
            }
            
            let keyboard = InlineKeyboardMarkup::new(buttons);
            
            bot.send_message(msg.chat.id, format!("Selected: {}\n\nChoose an action:", text_lower))
                .reply_markup(keyboard)
                .await?;
        } else {
            bot.send_message(
                msg.chat.id,
                "Chain not found. Use /start to see available chains or type a valid chain name.",
            )
            .await?;
        }
    }
    
    Ok(())
}

pub async fn handle_callback(
    bot: Bot,
    q: CallbackQuery,
) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    bot.answer_callback_query(q.id).await?;
    Ok(())
}