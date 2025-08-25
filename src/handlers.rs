use crate::{
    bot::{MyDialogue, State},
    cache::RegistryCache,
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
    cache: Arc<RegistryCache>,
    msg: Message,
) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    dialogue.update(State::SelectingChain { 
        page: 0, 
        is_testnet: false, 
        message_id: None, 
        last_selected_chain: None 
    }).await?;
    show_chain_selection(&bot, &msg, &cache, 0, false, None).await?;
    Ok(())
}

pub async fn restart(
    bot: Bot,
    dialogue: MyDialogue,
    cache: Arc<RegistryCache>,
    msg: Message,
) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    dialogue.reset().await?;
    start(bot, dialogue, cache, msg).await
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

pub async fn show_testnets(
    bot: Bot,
    dialogue: MyDialogue,
    cache: Arc<RegistryCache>,
    msg: Message,
) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    dialogue.update(State::SelectingChain { 
        page: 0, 
        is_testnet: true, 
        message_id: None,
        last_selected_chain: None 
    }).await?;
    show_chain_selection(&bot, &msg, &cache, 0, true, None).await?;
    Ok(())
}

pub async fn show_mainnets(
    bot: Bot,
    dialogue: MyDialogue,
    cache: Arc<RegistryCache>,
    msg: Message,
) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    dialogue.update(State::SelectingChain { 
        page: 0, 
        is_testnet: false, 
        message_id: None,
        last_selected_chain: None 
    }).await?;
    show_chain_selection(&bot, &msg, &cache, 0, false, None).await?;
    Ok(())
}

async fn show_chain_selection(
    bot: &Bot,
    msg: &Message,
    cache: &Arc<RegistryCache>,
    page: usize,
    is_testnet: bool,
    last_selected: Option<&String>,
) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
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
            .map(|chain| {
                let display_name = if last_selected.map_or(false, |s| s == chain) {
                    format!("🔴 {}", chain)
                } else {
                    chain.clone()
                };
                InlineKeyboardButton::callback(display_name, format!("select:{}", chain))
            })
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
        "Type a chain name, or select from menu:",
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
    (_page, is_testnet, _message_id, last_selected_chain): (usize, bool, Option<teloxide::types::MessageId>, Option<String>),
) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    if let Some(ref data) = q.data {
        if let Some(chain) = data.strip_prefix("select:") {
            let chain = chain.to_string();
            let msg_id = q.message.as_ref().map(|m| m.id);
            dialogue.update(State::ChainSelected { 
                chain: chain.clone(), 
                message_id: msg_id 
            }).await?;
            show_chain_menu(&bot, &q, &chain).await?;
        } else if let Some(page_str) = data.strip_prefix("page:") {
            let new_page: usize = page_str.parse()?;
            let msg_id = q.message.as_ref().map(|m| m.id);
            dialogue.update(State::SelectingChain { 
                page: new_page, 
                is_testnet,
                message_id: msg_id,
                last_selected_chain: last_selected_chain.clone()
            }).await?;
            update_chain_selection(&bot, &q, &cache, new_page, is_testnet, last_selected_chain.as_ref()).await?;
        } else if let Some(testnet_str) = data.strip_prefix("toggle_testnet:") {
            let new_testnet: bool = testnet_str.parse()?;
            let msg_id = q.message.as_ref().map(|m| m.id);
            dialogue.update(State::SelectingChain { 
                page: 0, 
                is_testnet: new_testnet,
                message_id: msg_id,
                last_selected_chain: None
            }).await?;
            update_chain_selection(&bot, &q, &cache, 0, new_testnet, None).await?;
        }
    }
    
    bot.answer_callback_query(q.id).await?;
    Ok(())
}

async fn update_chain_selection(
    bot: &Bot,
    q: &CallbackQuery,
    cache: &Arc<RegistryCache>,
    page: usize,
    is_testnet: bool,
    last_selected: Option<&String>,
) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
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
            .map(|chain| {
                let display_name = if last_selected.map_or(false, |s| s == chain) {
                    format!("🔴 {}", chain)
                } else {
                    chain.clone()
                };
                InlineKeyboardButton::callback(display_name, format!("select:{}", chain))
            })
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
    
    edit_callback_message_with_markup(
        bot,
        q,
        if is_testnet { "Select a testnet:" } else { "Select a chain:" }.to_string(),
        keyboard,
    )
    .await?;
    
    Ok(())
}

// Helper function to send a message from a callback query (for errors)
async fn send_callback_message(
    bot: &Bot,
    q: &CallbackQuery,
    text: String,
) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    if let Some(Message { chat, .. }) = &q.message {
        bot.send_message(chat.id, text).await?;
    }
    Ok(())
}

// Helper function to edit a message from a callback query
async fn edit_callback_message(
    bot: &Bot,
    q: &CallbackQuery,
    text: String,
    parse_mode: Option<ParseMode>,
) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    if let Some(Message { id, chat, .. }) = &q.message {
        let mut request = bot.edit_message_text(chat.id, *id, text);
        if let Some(mode) = parse_mode {
            request = request.parse_mode(mode);
        }
        request.await?;
    }
    Ok(())
}

// Helper function to edit a message with markup from a callback query
async fn edit_callback_message_with_markup(
    bot: &Bot,
    q: &CallbackQuery,
    text: String,
    keyboard: InlineKeyboardMarkup,
) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    if let Some(Message { id, chat, .. }) = &q.message {
        bot.edit_message_text(chat.id, *id, text)
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
    
    // Add IBC option for mainnets
    if !chain.contains("testnet") {
        buttons.push(vec![InlineKeyboardButton::callback("5. IBC-ID", "action:ibc_id")]);
    }
    
    buttons.push(vec![InlineKeyboardButton::callback("← Back", "back:chains")]);
    
    let keyboard = InlineKeyboardMarkup::new(buttons);
    
    edit_callback_message_with_markup(
        bot,
        q,
        format!("Selected: {}\n\nChoose an action:", chain),
        keyboard,
    )
    .await?;
    
    Ok(())
}

pub async fn handle_chain_action(
    bot: Bot,
    dialogue: MyDialogue,
    cache: Arc<RegistryCache>,
    q: CallbackQuery,
    (chain, _message_id): (String, Option<teloxide::types::MessageId>),
) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    if let Some(ref data) = q.data {
        match data.as_str() {
            "action:chain_info" => show_chain_info(&bot, &q, &cache, &chain).await?,
            "action:peer_nodes" => show_peer_nodes(&bot, &q, &cache, &chain).await?,
            "action:endpoints" => show_endpoints(&bot, &q, &cache, &chain).await?,
            "action:explorers" => show_explorers(&bot, &q, &cache, &chain).await?,
            "action:ibc_id" => {
                let msg_id = q.message.as_ref().map(|m| m.id);
                dialogue.update(State::AwaitingIbcDenom { chain, message_id: msg_id }).await?;
                if let Some(Message { chat, .. }) = &q.message {
                    bot.send_message(chat.id, "Enter IBC denom (e.g., ibc/ABC123...):")
                        .await?;
                }
            }
            "back:chains" => {
                let msg_id = q.message.as_ref().map(|m| m.id);
                dialogue.update(State::SelectingChain { 
                    page: 0, 
                    is_testnet: false,
                    message_id: msg_id,
                    last_selected_chain: Some(chain.clone())
                }).await?;
                update_chain_selection(&bot, &q, &cache, 0, false, Some(&chain)).await?;
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
        
        edit_callback_message(bot, q, message, Some(ParseMode::MarkdownV2)).await?
    } else {
        send_callback_message(bot, q, format!("Chain {} not found", chain)).await?;
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
        
        edit_callback_message(bot, q, message, Some(ParseMode::MarkdownV2)).await?
    } else {
        send_callback_message(bot, q, format!("Chain {} not found", chain)).await?;
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
        
        edit_callback_message(bot, q, message, Some(ParseMode::MarkdownV2)).await?
    } else {
        send_callback_message(bot, q, format!("Chain {} not found", chain)).await?;
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
        
        edit_callback_message(bot, q, message, Some(ParseMode::MarkdownV2)).await?
    } else {
        send_callback_message(bot, q, format!("Chain {} not found", chain)).await?;
    }
    
    Ok(())
}

pub async fn handle_ibc_denom(
    bot: Bot,
    dialogue: MyDialogue,
    cache: Arc<RegistryCache>,
    msg: Message,
    (chain, _message_id): (String, Option<teloxide::types::MessageId>),
) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    if let Some(text) = msg.text() {
        if let Some(ibc_hash) = text.strip_prefix("ibc/") {
            
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
    
    let msg_id = msg.id;
    dialogue.update(State::ChainSelected { chain, message_id: Some(msg_id) }).await?;
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
        
        // Handle numeric menu selection
        if let Ok(num) = text.parse::<usize>() {
            let state = dialogue.get().await?.unwrap_or_default();
            match state {
                State::ChainSelected { chain, .. } => {
                    let actions = vec![
                        "chain_info",
                        "peer_nodes",
                        "endpoints",
                        "explorers",
                        "ibc_id",
                    ];
                    
                    if num > 0 && num <= actions.len() {
                        let action = actions[num - 1];
                        
                        // Check if IBC-ID is valid for this chain
                        if action == "ibc_id" && chain.contains("testnet") {
                            bot.send_message(msg.chat.id, "IBC-ID is not available for testnets.").await?;
                            return Ok(());
                        }
                        
                        match action {
                            "chain_info" => {
                                let chain_data = cache.get_chain(&chain).await?;
                                let assets_data = cache.get_assets(&chain).await?;
                                
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
                                    
                                    bot.send_message(msg.chat.id, message)
                                        .parse_mode(ParseMode::MarkdownV2)
                                        .await?;
                                } else {
                                    bot.send_message(msg.chat.id, format!("Chain {} not found", chain)).await?;
                                }
                            }
                            "peer_nodes" => {
                                // Show peer nodes directly
                                let chain_data = cache.get_chain(&chain).await?;
                                
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
                                    
                                    bot.send_message(msg.chat.id, message)
                                        .parse_mode(ParseMode::MarkdownV2)
                                        .await?;
                                } else {
                                    bot.send_message(msg.chat.id, format!("Chain {} not found", chain)).await?;
                                }
                            }
                            "endpoints" => {
                                // Show endpoints directly
                                let chain_data = cache.get_chain(&chain).await?;
                                
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
                                    
                                    bot.send_message(msg.chat.id, message)
                                        .parse_mode(ParseMode::MarkdownV2)
                                        .await?;
                                } else {
                                    bot.send_message(msg.chat.id, format!("Chain {} not found", chain)).await?;
                                }
                            }
                            "explorers" => {
                                // Show explorers directly
                                let chain_data = cache.get_chain(&chain).await?;
                                
                                if let Some(chain_info) = chain_data {
                                    let mut message = String::from("*Block Explorers*\n\\-\\-\\-\\-\\-\\-\\-\\-\\-\\-\\-\\-\\-\\-\\-\n\n");
                                    
                                    for explorer in &chain_info.explorers {
                                        message.push_str(&format!(
                                            "*{}*:\n`{}`\n\n",
                                            escape_markdown(&explorer.kind),
                                            escape_markdown(&explorer.url)
                                        ));
                                    }
                                    
                                    bot.send_message(msg.chat.id, message)
                                        .parse_mode(ParseMode::MarkdownV2)
                                        .await?;
                                } else {
                                    bot.send_message(msg.chat.id, format!("Chain {} not found", chain)).await?;
                                }
                            }
                            "ibc_id" => {
                                dialogue.update(State::AwaitingIbcDenom { chain, message_id: Some(msg.id) }).await?;
                                bot.send_message(msg.chat.id, "Enter IBC denom (e.g., ibc/ABC123...):").await?;
                            }
                            _ => {}
                        }
                    } else {
                        bot.send_message(msg.chat.id, "Invalid option number. Please try again.").await?;
                    }
                }
                _ => {
                    bot.send_message(
                        msg.chat.id,
                        "No chain selected. Please select a chain first using /start",
                    )
                    .await?;
                }
            }
            return Ok(());
        }
        
        // Handle direct IBC denom input
        if text_lower.starts_with("ibc/") {
            // Get current state to find the selected chain
            let state = dialogue.get().await?.unwrap_or_default();
            match state {
                State::ChainSelected { chain, .. } | 
                State::AwaitingIbcDenom { chain, .. } => {
                    let ibc_hash = &text[4..]; // Remove "ibc/" prefix
                    
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
                                    bot.send_message(
                                        msg.chat.id,
                                        "Failed to fetch IBC denom trace or it does not exist.",
                                    )
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
                }
                _ => {
                    bot.send_message(
                        msg.chat.id,
                        "No chain selected. Please select a chain first using /start",
                    )
                    .await?;
                }
            }
            return Ok(());
        }
        
        // Check if it's a chain name
        let chains = cache.list_chains().await?;
        if chains.iter().any(|c| c.to_lowercase() == text_lower) {
            let msg_id = msg.id;
            dialogue.update(State::ChainSelected { chain: text_lower.clone(), message_id: Some(msg_id) }).await?;
            
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
            
            // Add IBC option for mainnets
            // Check if it's a testnet by seeing if it's in the testnets list
            let testnets = cache.list_testnets().await.unwrap_or_default();
            if !testnets.iter().any(|t| t.to_lowercase() == text_lower) {
                buttons.push(vec![InlineKeyboardButton::callback("5. IBC-ID", "action:ibc_id")]);
            }
            
            buttons.push(vec![InlineKeyboardButton::callback("← Back", "back:chains")]);
            
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
    dialogue: MyDialogue,
    _cache: Arc<RegistryCache>,
    q: CallbackQuery,
) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    // This is a fallback handler for callbacks that don't match expected states
    // Reset the dialogue and prompt user to start over
    dialogue.reset().await?;
    
    if let Some(Message { chat, .. }) = &q.message {
        bot.send_message(
            chat.id,
            "Session expired or invalid state. Please use /start to begin again.",
        )
        .await?;
    }
    
    bot.answer_callback_query(q.id).await?;
    Ok(())
}