use crate::{
    bot::{MyDialogue, State},
    cache::RegistryCache,
    utils::{
        escape_markdown, extract_channel_from_path, find_healthy_grpc_endpoint,
        first_endpoint_address, format_channel_input, format_osmosis_pool_incentives,
        format_osmosis_pool_info, format_osmosis_token_price, format_wallet_balances,
        get_polkachu_installation_url, query_abci_info_grpc, query_balances_grpc_first,
        query_ibc_channel_info_grpc_first, query_ibc_denom_grpc_first,
        query_osmosis_pool_incentives, query_osmosis_pool_info, query_osmosis_token_price,
        WalletBalance, PAGE_SIZE,
    },
};
use cosmos_chain_registry::AssetList;
use std::sync::Arc;
use teloxide::{
    prelude::*,
    types::{ChatAction, ChatId, InlineKeyboardButton, InlineKeyboardMarkup, MessageId, ParseMode},
};

pub async fn start(
    bot: Bot,
    dialogue: MyDialogue,
    cache: Arc<RegistryCache>,
    msg: Message,
) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    dialogue
        .update(State::SelectingChain {
            page: 0,
            is_testnet: false,
            message_id: None,
            last_selected_chain: None,
        })
        .await?;
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

pub async fn help(bot: Bot, msg: Message) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
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
    dialogue
        .update(State::SelectingChain {
            page: 0,
            is_testnet: true,
            message_id: None,
            last_selected_chain: None,
        })
        .await?;
    show_chain_selection(&bot, &msg, &cache, 0, true, None).await?;
    Ok(())
}

pub async fn show_mainnets(
    bot: Bot,
    dialogue: MyDialogue,
    cache: Arc<RegistryCache>,
    msg: Message,
) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    dialogue
        .update(State::SelectingChain {
            page: 0,
            is_testnet: false,
            message_id: None,
            last_selected_chain: None,
        })
        .await?;
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
    let filtered_chains: Vec<String> = if is_testnet {
        cache.list_testnets().await?
    } else {
        cache.list_chains().await?
    };

    let total_pages = filtered_chains.len().div_ceil(PAGE_SIZE);
    let start = page * PAGE_SIZE;
    let end = (start + PAGE_SIZE).min(filtered_chains.len());

    let page_chains = &filtered_chains[start..end];

    let mut buttons = vec![];
    for chunk in page_chains.chunks(3) {
        let row: Vec<InlineKeyboardButton> = chunk
            .iter()
            .map(|chain| {
                let display_name = if last_selected == Some(chain) {
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
        nav_buttons.push(InlineKeyboardButton::callback(
            "← Previous",
            format!("page:{}", page - 1),
        ));
    }
    if page < total_pages - 1 {
        nav_buttons.push(InlineKeyboardButton::callback(
            "Next →",
            format!("page:{}", page + 1),
        ));
    }
    if !nav_buttons.is_empty() {
        buttons.push(nav_buttons);
    }

    // Testnet toggle
    buttons.push(vec![InlineKeyboardButton::callback(
        if is_testnet {
            "Show Mainnets"
        } else {
            "Show Testnets"
        },
        format!("toggle_testnet:{}", !is_testnet),
    )]);

    let keyboard = InlineKeyboardMarkup::new(buttons);

    bot.send_message(msg.chat.id, "Type a chain name, or select from menu:")
        .reply_markup(keyboard)
        .await?;

    Ok(())
}

pub async fn handle_chain_selection(
    bot: Bot,
    dialogue: MyDialogue,
    cache: Arc<RegistryCache>,
    q: CallbackQuery,
    (_page, is_testnet, _message_id, last_selected_chain): (
        usize,
        bool,
        Option<teloxide::types::MessageId>,
        Option<String>,
    ),
) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    if let Some(ref data) = q.data {
        if let Some(chain) = data.strip_prefix("select:") {
            let chain = chain.to_string();
            // Delete the current chain selection menu
            if let Some(Message { id, chat, .. }) = &q.message {
                if let Err(e) = bot.delete_message(chat.id, *id).await {
                    eprintln!("Failed to delete chain selection menu: {}", e);
                }
            }
            let new_menu_id = show_chain_menu(&bot, &q, &chain).await?;
            dialogue
                .update(State::ChainSelected {
                    chain: chain.clone(),
                    message_id: Some(new_menu_id),
                })
                .await?;
        } else if let Some(page_str) = data.strip_prefix("page:") {
            let new_page: usize = page_str.parse()?;
            let msg_id = q.message.as_ref().map(|m| m.id);
            dialogue
                .update(State::SelectingChain {
                    page: new_page,
                    is_testnet,
                    message_id: msg_id,
                    last_selected_chain: last_selected_chain.clone(),
                })
                .await?;
            update_chain_selection(
                &bot,
                &q,
                &cache,
                new_page,
                is_testnet,
                last_selected_chain.as_ref(),
            )
            .await?;
        } else if let Some(testnet_str) = data.strip_prefix("toggle_testnet:") {
            let new_testnet: bool = testnet_str.parse()?;
            let msg_id = q.message.as_ref().map(|m| m.id);
            dialogue
                .update(State::SelectingChain {
                    page: 0,
                    is_testnet: new_testnet,
                    message_id: msg_id,
                    last_selected_chain: None,
                })
                .await?;
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
    let filtered_chains: Vec<String> = if is_testnet {
        cache.list_testnets().await?
    } else {
        cache.list_chains().await?
    };

    let total_pages = filtered_chains.len().div_ceil(PAGE_SIZE);
    let start = page * PAGE_SIZE;
    let end = (start + PAGE_SIZE).min(filtered_chains.len());

    let page_chains = &filtered_chains[start..end];

    let mut buttons = vec![];
    for chunk in page_chains.chunks(3) {
        let row: Vec<InlineKeyboardButton> = chunk
            .iter()
            .map(|chain| {
                let display_name = if last_selected == Some(chain) {
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
        nav_buttons.push(InlineKeyboardButton::callback(
            "← Previous",
            format!("page:{}", page - 1),
        ));
    }
    if page < total_pages - 1 {
        nav_buttons.push(InlineKeyboardButton::callback(
            "Next →",
            format!("page:{}", page + 1),
        ));
    }
    if !nav_buttons.is_empty() {
        buttons.push(nav_buttons);
    }

    // Testnet toggle
    buttons.push(vec![InlineKeyboardButton::callback(
        if is_testnet {
            "Show Mainnets"
        } else {
            "Show Testnets"
        },
        format!("toggle_testnet:{}", !is_testnet),
    )]);

    let keyboard = InlineKeyboardMarkup::new(buttons);

    edit_callback_message_with_markup(
        bot,
        q,
        if is_testnet {
            "Select a testnet:"
        } else {
            "Select a chain:"
        }
        .to_string(),
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

async fn edit_status_message(
    bot: &Bot,
    chat_id: ChatId,
    message_id: MessageId,
    text: String,
    parse_mode: Option<ParseMode>,
) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    if let Some(parse_mode) = parse_mode {
        bot.edit_message_text(chat_id, message_id, text)
            .parse_mode(parse_mode)
            .await?;
    } else {
        bot.edit_message_text(chat_id, message_id, text).await?;
    }

    Ok(())
}

fn split_telegram_message(text: &str, max_len: usize) -> Vec<String> {
    let mut chunks = Vec::new();
    let mut current = String::new();

    for block in text.split("\n\n") {
        let separator_len = if current.is_empty() { 0 } else { 2 };
        if !current.is_empty() && current.len() + separator_len + block.len() > max_len {
            chunks.push(current);
            current = block.to_string();
        } else {
            if !current.is_empty() {
                current.push_str("\n\n");
            }
            current.push_str(block);
        }
    }

    if !current.is_empty() {
        chunks.push(current);
    }

    chunks
}

async fn edit_or_send_markdown_result(
    bot: &Bot,
    chat_id: ChatId,
    status_id: MessageId,
    message: String,
) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    let chunks = split_telegram_message(&message, 3800);

    if chunks.len() == 1 {
        edit_status_message(
            bot,
            chat_id,
            status_id,
            message,
            Some(ParseMode::MarkdownV2),
        )
        .await?;
        return Ok(());
    }

    edit_status_message(
        bot,
        chat_id,
        status_id,
        format!("Found a large response; sending {} parts...", chunks.len()),
        None,
    )
    .await?;

    for chunk in chunks {
        bot.send_message(chat_id, chunk)
            .parse_mode(ParseMode::MarkdownV2)
            .await?;
    }

    Ok(())
}

async fn send_processing_action(bot: &Bot, chat_id: ChatId) {
    if let Err(e) = bot.send_chat_action(chat_id, ChatAction::Typing).await {
        log::debug!("Could not send Telegram processing action: {}", e);
    }
}

fn is_osmosis_mainnet(chain: &str) -> bool {
    chain.eq_ignore_ascii_case("osmosis")
}

fn push_osmosis_buttons(buttons: &mut Vec<Vec<InlineKeyboardButton>>) {
    buttons.push(vec![
        InlineKeyboardButton::callback("8. LP Incentives", "action:pool_incentives"),
        InlineKeyboardButton::callback("9. Pool Info", "action:pool_info"),
    ]);
    buttons.push(vec![InlineKeyboardButton::callback(
        "10. Price Info",
        "action:price_info",
    )]);
}

async fn show_chain_menu(
    bot: &Bot,
    q: &CallbackQuery,
    chain: &str,
) -> Result<MessageId, Box<dyn std::error::Error + Send + Sync>> {
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

    // Add IBC options and balance check for mainnets
    if !chain.contains("testnet") {
        buttons.push(vec![
            InlineKeyboardButton::callback("5. IBC-ID", "action:ibc_id"),
            InlineKeyboardButton::callback("6. IBC Route Info", "action:ibc_route"),
        ]);
        buttons.push(vec![InlineKeyboardButton::callback(
            "7. Check Balance",
            "action:check_balance",
        )]);
        if is_osmosis_mainnet(chain) {
            push_osmosis_buttons(&mut buttons);
        }
    }

    // Add installation guide link if available on Polkachu
    if let Some(install_url) = get_polkachu_installation_url(chain) {
        buttons.push(vec![InlineKeyboardButton::url(
            "Node Installation Guide",
            install_url.parse().unwrap(),
        )]);
    }

    buttons.push(vec![InlineKeyboardButton::callback(
        "← Back",
        "back:chains",
    )]);

    let keyboard = InlineKeyboardMarkup::new(buttons);

    // Send as a new message instead of editing
    if let Some(Message { chat, .. }) = &q.message {
        let sent_msg = bot
            .send_message(chat.id, format!("Selected: {}\n\nChoose an action:", chain))
            .reply_markup(keyboard)
            .await?;
        return Ok(sent_msg.id);
    }

    Err("No message in callback query".into())
}

// Helper function to delete a message with a transition effect
async fn delete_message_with_effect(
    bot: &Bot,
    chat_id: ChatId,
    message_id: MessageId,
) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    // First update the message with a vaporizing effect
    let effects = vec!["💨 ᵈⁱˢˢᵒˡᵛⁱⁿᵍ...", "✨ ..."];

    for effect in effects {
        bot.edit_message_text(chat_id, message_id, effect).await?;
        tokio::time::sleep(tokio::time::Duration::from_millis(200)).await;
    }

    // Then delete the message
    bot.delete_message(chat_id, message_id).await?;
    Ok(())
}

// Helper function to send chain menu as a new message
async fn send_chain_menu(
    bot: &Bot,
    msg: &Message,
    chain: &str,
) -> Result<MessageId, Box<dyn std::error::Error + Send + Sync>> {
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

    // Add IBC options and balance check for mainnets
    if !chain.contains("testnet") {
        buttons.push(vec![
            InlineKeyboardButton::callback("5. IBC-ID", "action:ibc_id"),
            InlineKeyboardButton::callback("6. IBC Route Info", "action:ibc_route"),
        ]);
        buttons.push(vec![InlineKeyboardButton::callback(
            "7. Check Balance",
            "action:check_balance",
        )]);
        if is_osmosis_mainnet(chain) {
            push_osmosis_buttons(&mut buttons);
        }
    }

    // Add installation guide link if available on Polkachu
    if let Some(install_url) = get_polkachu_installation_url(chain) {
        buttons.push(vec![InlineKeyboardButton::url(
            "Node Installation Guide",
            install_url.parse().unwrap(),
        )]);
    }

    buttons.push(vec![InlineKeyboardButton::callback(
        "← Back",
        "back:chains",
    )]);

    let keyboard = InlineKeyboardMarkup::new(buttons);

    let sent_msg = bot
        .send_message(
            msg.chat.id,
            format!("Selected: {}\n\nChoose an action:", chain),
        )
        .reply_markup(keyboard)
        .await?;

    Ok(sent_msg.id)
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
            "action:chain_info" => {
                // Delete the menu with effect
                if let Some(Message { id, chat, .. }) = &q.message {
                    delete_message_with_effect(&bot, chat.id, *id).await?;
                }
                // Send info as new message
                show_chain_info(&bot, &q, &cache, &chain).await?;
                // Show menu again after displaying info
                let new_menu_id = show_chain_menu(&bot, &q, &chain).await?;
                dialogue
                    .update(State::ChainSelected {
                        chain: chain.clone(),
                        message_id: Some(new_menu_id),
                    })
                    .await?;
            }
            "action:peer_nodes" => {
                // Delete the menu with effect
                if let Some(Message { id, chat, .. }) = &q.message {
                    delete_message_with_effect(&bot, chat.id, *id).await?;
                }
                // Send info as new message
                show_peer_nodes(&bot, &q, &cache, &chain).await?;
                // Show menu again after displaying info
                let new_menu_id = show_chain_menu(&bot, &q, &chain).await?;
                dialogue
                    .update(State::ChainSelected {
                        chain: chain.clone(),
                        message_id: Some(new_menu_id),
                    })
                    .await?;
            }
            "action:endpoints" => {
                // Delete the menu with effect
                if let Some(Message { id, chat, .. }) = &q.message {
                    delete_message_with_effect(&bot, chat.id, *id).await?;
                }
                // Send info as new message
                show_endpoints(&bot, &q, &cache, &chain).await?;
                // Show menu again after displaying info
                let new_menu_id = show_chain_menu(&bot, &q, &chain).await?;
                dialogue
                    .update(State::ChainSelected {
                        chain: chain.clone(),
                        message_id: Some(new_menu_id),
                    })
                    .await?;
            }
            "action:explorers" => {
                // Delete the menu with effect
                if let Some(Message { id, chat, .. }) = &q.message {
                    delete_message_with_effect(&bot, chat.id, *id).await?;
                }
                // Send info as new message
                show_explorers(&bot, &q, &cache, &chain).await?;
                // Show menu again after displaying info
                let new_menu_id = show_chain_menu(&bot, &q, &chain).await?;
                dialogue
                    .update(State::ChainSelected {
                        chain: chain.clone(),
                        message_id: Some(new_menu_id),
                    })
                    .await?;
            }
            "action:ibc_id" => {
                // Delete the menu with effect
                if let Some(Message { id, chat, .. }) = &q.message {
                    delete_message_with_effect(&bot, chat.id, *id).await?;
                    let msg_id = q.message.as_ref().map(|m| m.id);
                    dialogue
                        .update(State::AwaitingIbcDenom {
                            chain,
                            message_id: msg_id,
                        })
                        .await?;
                    bot.send_message(chat.id, "Enter IBC denom (e.g., ibc/ABC123...):")
                        .await?;
                }
            }
            "action:ibc_route" => {
                // Delete the menu with effect
                if let Some(Message { id, chat, .. }) = &q.message {
                    delete_message_with_effect(&bot, chat.id, *id).await?;
                    let msg_id = q.message.as_ref().map(|m| m.id);
                    dialogue
                        .update(State::AwaitingIbcChannel {
                            chain,
                            message_id: msg_id,
                        })
                        .await?;
                    bot.send_message(chat.id, "Enter IBC channel (e.g., 0 or channel-0):\nOptionally add port (e.g., channel-0 transfer):")
                        .await?;
                }
            }
            "action:check_balance" => {
                // Delete the menu with effect
                if let Some(Message { id, chat, .. }) = &q.message {
                    delete_message_with_effect(&bot, chat.id, *id).await?;
                    let msg_id = q.message.as_ref().map(|m| m.id);
                    dialogue
                        .update(State::AwaitingWalletAddress {
                            chain,
                            message_id: msg_id,
                        })
                        .await?;
                    bot.send_message(chat.id, "Enter wallet address to check balance:")
                        .await?;
                }
            }
            "action:pool_incentives" => {
                if let Some(Message { id, chat, .. }) = &q.message {
                    delete_message_with_effect(&bot, chat.id, *id).await?;
                    if is_osmosis_mainnet(&chain) {
                        let msg_id = q.message.as_ref().map(|m| m.id);
                        dialogue
                            .update(State::AwaitingOsmosisPoolIncentives {
                                chain,
                                message_id: msg_id,
                            })
                            .await?;
                        bot.send_message(chat.id, "Enter Osmosis pool ID for LP incentives:")
                            .await?;
                    } else {
                        bot.send_message(chat.id, "LP incentives are only available for Osmosis.")
                            .await?;
                    }
                }
            }
            "action:pool_info" => {
                if let Some(Message { id, chat, .. }) = &q.message {
                    delete_message_with_effect(&bot, chat.id, *id).await?;
                    if is_osmosis_mainnet(&chain) {
                        let msg_id = q.message.as_ref().map(|m| m.id);
                        dialogue
                            .update(State::AwaitingOsmosisPoolInfo {
                                chain,
                                message_id: msg_id,
                            })
                            .await?;
                        bot.send_message(chat.id, "Enter Osmosis pool ID for pool info:")
                            .await?;
                    } else {
                        bot.send_message(chat.id, "Pool info is only available for Osmosis.")
                            .await?;
                    }
                }
            }
            "action:price_info" => {
                if let Some(Message { id, chat, .. }) = &q.message {
                    delete_message_with_effect(&bot, chat.id, *id).await?;
                    if is_osmosis_mainnet(&chain) {
                        let msg_id = q.message.as_ref().map(|m| m.id);
                        dialogue
                            .update(State::AwaitingOsmosisTokenTicker {
                                chain,
                                message_id: msg_id,
                            })
                            .await?;
                        bot.send_message(chat.id, "Enter Osmosis token symbol or base denom:")
                            .await?;
                    } else {
                        bot.send_message(chat.id, "Price info is only available for Osmosis.")
                            .await?;
                    }
                }
            }
            "back:chains" => {
                // No need to delete - update_chain_selection will edit the existing message
                let msg_id = q.message.as_ref().map(|m| m.id);
                dialogue
                    .update(State::SelectingChain {
                        page: 0,
                        is_testnet: false,
                        message_id: msg_id,
                        last_selected_chain: Some(chain.clone()),
                    })
                    .await?;
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

        let rpc = first_endpoint_address(&chain_info.apis.rpc);
        let rest = first_endpoint_address(&chain_info.apis.rest);

        let grpc = find_healthy_grpc_endpoint(&chain_info.apis.grpc)
            .await
            .unwrap_or_else(|| "Unknown".to_string());

        let explorer = chain_info
            .explorers
            .first()
            .map(|e| e.url.as_str())
            .unwrap_or("Unknown");

        // User-visible status queries should use gRPC; RPC/REST endpoints are displayed only.
        let abci_info = if grpc != "Unknown" {
            query_abci_info_grpc(&grpc).await
        } else {
            None
        };

        let mut message = format!(
            "🔗 *{}*\n\n\
            Chain ID: `{}`\n\
            Chain Name: `{}`\n\
            RPC: `{}`\n\
            REST: `{}`\n\
            GRPC: `{}`\n\
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
            escape_markdown(&grpc),
            escape_markdown(&chain_info.bech32_prefix),
            escape_markdown(base_denom),
            chain_info.slip44,
            decimals,
            escape_markdown(explorer)
        );

        // Append ABCI info if available
        if let Some(info) = abci_info {
            message.push_str(&format!(
                "\n\n*Node Status*\n\
                Version: `{}`\n\
                Latest Block: `{}`\n\
                App Hash: `{}`",
                escape_markdown(&info.version),
                escape_markdown(&info.last_block_height),
                escape_markdown(&info.last_block_app_hash)
            ));
        }

        // Send as new message instead of editing
        if let Some(Message { chat, .. }) = &q.message {
            bot.send_message(chat.id, message)
                .parse_mode(ParseMode::MarkdownV2)
                .await?;
        }
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

        // Send as new message instead of editing
        if let Some(Message { chat, .. }) = &q.message {
            bot.send_message(chat.id, message)
                .parse_mode(ParseMode::MarkdownV2)
                .await?;
        }
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

        if !chain_info.apis.evm_http_jsonrpc.is_empty() {
            message.push_str("\n*EVM RPC*\n\\-\\-\\-\\-\\-\\-\\-\\-\n");

            for evm_rpc in chain_info.apis.evm_http_jsonrpc.iter().take(5) {
                let provider = evm_rpc.provider.as_deref().unwrap_or("unknown");
                message.push_str(&format!(
                    "*{}*:\n`{}`\n\n",
                    escape_markdown(provider),
                    escape_markdown(&evm_rpc.address)
                ));
            }
        }

        // Send as new message instead of editing
        if let Some(Message { chat, .. }) = &q.message {
            bot.send_message(chat.id, message)
                .parse_mode(ParseMode::MarkdownV2)
                .await?;
        }
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
        let mut message =
            String::from("*Block Explorers*\n\\-\\-\\-\\-\\-\\-\\-\\-\\-\\-\\-\\-\\-\\-\\-\n\n");

        for explorer in &chain_info.explorers {
            message.push_str(&format!(
                "*{}*:\n`{}`\n\n",
                escape_markdown(&explorer.kind),
                escape_markdown(&explorer.url)
            ));
        }

        // Send as new message instead of editing
        if let Some(Message { chat, .. }) = &q.message {
            bot.send_message(chat.id, message)
                .parse_mode(ParseMode::MarkdownV2)
                .await?;
        }
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
            send_processing_action(&bot, msg.chat.id).await;
            let status = bot
                .send_message(msg.chat.id, format!("Resolving IBC denom on {chain}..."))
                .await?;

            if let Some(chain_info) = cache.get_chain(&chain).await? {
                match query_ibc_denom_grpc_first(&chain_info.apis.grpc, ibc_hash).await {
                    Ok(trace) => {
                        let mut message = if !trace.path.is_empty() {
                            format!(
                                "✅ IBC Denom Trace Found:\n\nPath: {}\nBase Denomination: {}",
                                trace.path, trace.base_denom
                            )
                        } else {
                            format!(
                                "✅ IBC Denom Trace Found:\n\nBase Denomination: {}",
                                trace.base_denom
                            )
                        };

                        // Try to extract channel from path and fetch route info
                        if !trace.path.is_empty() {
                            if let Some(channel) = extract_channel_from_path(&trace.path) {
                                match query_ibc_channel_info_grpc_first(
                                    &chain_info.apis.grpc,
                                    &channel,
                                    "transfer",
                                )
                                .await
                                {
                                    Ok(info) => {
                                        message.push_str(&format!(
                                            "\n\n📍 Source Chain: {}\nvia {}",
                                            info.counterparty_chain_id, channel
                                        ));
                                    }
                                    Err(e) => {
                                        log::warn!(
                                            "Could not fetch channel info for {}: {}",
                                            channel,
                                            e
                                        );
                                    }
                                }
                            }
                        }

                        edit_status_message(&bot, msg.chat.id, status.id, message, None).await?;
                    }
                    Err(e) => {
                        let error_message = format!(
                            "❌ Could not resolve IBC denom:\n{}\n\nThis denom might not exist on {} or the chain's APIs might be unavailable.",
                            e, chain
                        );
                        edit_status_message(&bot, msg.chat.id, status.id, error_message, None)
                            .await?;
                    }
                }
            } else {
                edit_status_message(
                    &bot,
                    msg.chat.id,
                    status.id,
                    "Chain not found".to_string(),
                    None,
                )
                .await?;
            }
        } else {
            bot.send_message(
                msg.chat.id,
                "Please enter a valid IBC denom (e.g., ibc/ABC123...)",
            )
            .await?;
        }

        // Show the menu after showing IBC info
        let new_menu_id = send_chain_menu(&bot, &msg, &chain).await?;
        dialogue
            .update(State::ChainSelected {
                chain: chain.clone(),
                message_id: Some(new_menu_id),
            })
            .await?;
    } else {
        dialogue
            .update(State::ChainSelected {
                chain,
                message_id: None,
            })
            .await?;
    }
    Ok(())
}

pub async fn handle_ibc_channel(
    bot: Bot,
    dialogue: MyDialogue,
    cache: Arc<RegistryCache>,
    msg: Message,
    (chain, _message_id): (String, Option<MessageId>),
) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    if let Some(text) = msg.text() {
        // Parse the input - could be "23", "channel-23", or "channel-23 transfer"
        let parts: Vec<&str> = text.split_whitespace().collect();
        let channel_input = parts.first().unwrap_or(&"");
        let port_id = parts.get(1).unwrap_or(&"transfer");

        let channel_id = format_channel_input(channel_input);

        // Validate channel format
        if !channel_id.starts_with("channel-") {
            bot.send_message(
                msg.chat.id,
                "Please enter a valid channel (e.g., 0, channel-0)",
            )
            .await?;
            let new_menu_id = send_chain_menu(&bot, &msg, &chain).await?;
            dialogue
                .update(State::ChainSelected {
                    chain: chain.clone(),
                    message_id: Some(new_menu_id),
                })
                .await?;
            return Ok(());
        }

        send_processing_action(&bot, msg.chat.id).await;
        let status = bot
            .send_message(msg.chat.id, format!("Looking up IBC route on {chain}..."))
            .await?;

        if let Some(chain_info) = cache.get_chain(&chain).await? {
            match query_ibc_channel_info_grpc_first(&chain_info.apis.grpc, &channel_id, port_id)
                .await
            {
                Ok(info) => {
                    let message = format!(
                        "✅ IBC Route Information\n\n\
                        Source Chain: {}\n\
                        Destination Chain: {}\n\n\
                        Channel Details:\n\
                        • Channel: {}\n\
                        • Port: {}\n\
                        • Client ID: {}\n\
                        • Connection: {}\n\n\
                        Counterparty Details:\n\
                        • Channel: {}\n\
                        • Client ID: {}\n\
                        • Connection: {}",
                        info.chain_id,
                        info.counterparty_chain_id,
                        info.channel_id,
                        port_id,
                        info.client_id,
                        info.connection_id,
                        info.counterparty_channel_id,
                        info.counterparty_client_id,
                        info.counterparty_connection_id
                    );
                    edit_status_message(&bot, msg.chat.id, status.id, message, None).await?;
                }
                Err(e) => {
                    let error_message = format!(
                        "❌ Could not fetch IBC route info:\n{}\n\n\
                        Make sure the channel exists on {}.",
                        e, chain
                    );
                    edit_status_message(&bot, msg.chat.id, status.id, error_message, None).await?;
                }
            }
        } else {
            edit_status_message(
                &bot,
                msg.chat.id,
                status.id,
                "Chain not found".to_string(),
                None,
            )
            .await?;
        }

        // Show the menu after showing IBC route info
        let new_menu_id = send_chain_menu(&bot, &msg, &chain).await?;
        dialogue
            .update(State::ChainSelected {
                chain: chain.clone(),
                message_id: Some(new_menu_id),
            })
            .await?;
    } else {
        dialogue
            .update(State::ChainSelected {
                chain,
                message_id: None,
            })
            .await?;
    }
    Ok(())
}

fn asset_label_for_denom(assets: Option<&AssetList>, denom: &str) -> Option<String> {
    let asset = assets?.assets.iter().find(|asset| {
        asset.base == denom
            || asset
                .denom_units
                .iter()
                .any(|denom_unit| denom_unit.denom == denom)
    })?;

    [&asset.symbol, &asset.name, &asset.display]
        .into_iter()
        .find(|label| !label.is_empty())
        .cloned()
}

pub async fn handle_wallet_address(
    bot: Bot,
    dialogue: MyDialogue,
    cache: Arc<RegistryCache>,
    msg: Message,
    (chain, _message_id): (String, Option<MessageId>),
) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    if let Some(text) = msg.text() {
        let address = text.trim();

        // Basic validation
        if address.is_empty() || address.len() < 10 || address.len() > 100 {
            bot.send_message(msg.chat.id, "Please enter a valid wallet address.")
                .await?;
            let new_menu_id = send_chain_menu(&bot, &msg, &chain).await?;
            dialogue
                .update(State::ChainSelected {
                    chain: chain.clone(),
                    message_id: Some(new_menu_id),
                })
                .await?;
            return Ok(());
        }

        send_processing_action(&bot, msg.chat.id).await;
        let status = bot
            .send_message(msg.chat.id, format!("Checking balances on {chain}..."))
            .await?;

        if let Some(chain_info) = cache.get_chain(&chain).await? {
            let assets_data = match cache.get_assets(&chain).await {
                Ok(assets) => assets,
                Err(e) => {
                    log::warn!("Could not fetch asset metadata for {}: {}", chain, e);
                    None
                }
            };

            match query_balances_grpc_first(&chain_info.apis.grpc, address, None).await {
                Ok((balances, next_key)) => {
                    if balances.is_empty() {
                        let message = format!(
                            "No balances found for address:\n`{}`\n\n\
                            The address might be empty or invalid for {}\\.",
                            escape_markdown(address),
                            escape_markdown(&chain)
                        );
                        edit_or_send_markdown_result(&bot, msg.chat.id, status.id, message).await?;
                    } else {
                        let mut wallet_balances = Vec::with_capacity(balances.len());
                        for balance in balances {
                            let ibc_trace = if let Some(ibc_hash) =
                                balance.denom.strip_prefix("ibc/")
                            {
                                match query_ibc_denom_grpc_first(&chain_info.apis.grpc, ibc_hash)
                                    .await
                                {
                                    Ok(trace) => Some(trace),
                                    Err(e) => {
                                        log::warn!(
                                            "Could not resolve IBC denom {}: {}",
                                            balance.denom,
                                            e
                                        );
                                        None
                                    }
                                }
                            } else {
                                None
                            };
                            let asset_label =
                                asset_label_for_denom(assets_data.as_ref(), &balance.denom);

                            wallet_balances.push(WalletBalance {
                                balance,
                                ibc_trace,
                                asset_label,
                            });
                        }

                        let message = format_wallet_balances(
                            address,
                            &chain,
                            &wallet_balances,
                            next_key.is_some(),
                        );
                        edit_or_send_markdown_result(&bot, msg.chat.id, status.id, message).await?;
                    }
                }
                Err(e) => {
                    let error_message = format!(
                        "❌ Could not fetch balances:\n{}\n\n\
                        The address might be invalid or the chain's APIs might be unavailable\\.",
                        escape_markdown(&e.to_string())
                    );
                    edit_or_send_markdown_result(&bot, msg.chat.id, status.id, error_message)
                        .await?;
                }
            }
        } else {
            edit_status_message(
                &bot,
                msg.chat.id,
                status.id,
                "Chain not found".to_string(),
                None,
            )
            .await?;
        }

        // Show the menu after showing balance info
        let new_menu_id = send_chain_menu(&bot, &msg, &chain).await?;
        dialogue
            .update(State::ChainSelected {
                chain: chain.clone(),
                message_id: Some(new_menu_id),
            })
            .await?;
    } else {
        dialogue
            .update(State::ChainSelected {
                chain,
                message_id: None,
            })
            .await?;
    }
    Ok(())
}

fn parse_pool_id(text: &str) -> Option<String> {
    let trimmed = text.trim();
    if trimmed.parse::<u64>().is_ok() {
        Some(trimmed.to_string())
    } else {
        None
    }
}

pub async fn handle_osmosis_pool_incentives(
    bot: Bot,
    dialogue: MyDialogue,
    cache: Arc<RegistryCache>,
    msg: Message,
    (chain, _message_id): (String, Option<MessageId>),
) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    if let Some(text) = msg.text() {
        let Some(pool_id) = parse_pool_id(text) else {
            bot.send_message(msg.chat.id, "Please enter a numeric Osmosis pool ID.")
                .await?;
            let new_menu_id = send_chain_menu(&bot, &msg, &chain).await?;
            dialogue
                .update(State::ChainSelected {
                    chain: chain.clone(),
                    message_id: Some(new_menu_id),
                })
                .await?;
            return Ok(());
        };

        let status = bot
            .send_message(
                msg.chat.id,
                format!("Fetching Osmosis pool {pool_id} incentives..."),
            )
            .await?;

        if let Some(chain_info) = cache.get_chain(&chain).await? {
            match query_osmosis_pool_incentives(&chain_info.apis.grpc, &pool_id).await {
                Ok(incentives) => {
                    edit_status_message(
                        &bot,
                        msg.chat.id,
                        status.id,
                        format_osmosis_pool_incentives(&pool_id, &incentives),
                        None,
                    )
                    .await?;
                }
                Err(e) => {
                    edit_status_message(
                        &bot,
                        msg.chat.id,
                        status.id,
                        format!("Could not fetch Osmosis pool incentives: {e}"),
                        None,
                    )
                    .await?;
                }
            }
        } else {
            edit_status_message(
                &bot,
                msg.chat.id,
                status.id,
                "Osmosis chain info not found.".to_string(),
                None,
            )
            .await?;
        }

        let new_menu_id = send_chain_menu(&bot, &msg, &chain).await?;
        dialogue
            .update(State::ChainSelected {
                chain: chain.clone(),
                message_id: Some(new_menu_id),
            })
            .await?;
    }
    Ok(())
}

pub async fn handle_osmosis_pool_info(
    bot: Bot,
    dialogue: MyDialogue,
    cache: Arc<RegistryCache>,
    msg: Message,
    (chain, _message_id): (String, Option<MessageId>),
) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    if let Some(text) = msg.text() {
        let Some(pool_id) = parse_pool_id(text) else {
            bot.send_message(msg.chat.id, "Please enter a numeric Osmosis pool ID.")
                .await?;
            let new_menu_id = send_chain_menu(&bot, &msg, &chain).await?;
            dialogue
                .update(State::ChainSelected {
                    chain: chain.clone(),
                    message_id: Some(new_menu_id),
                })
                .await?;
            return Ok(());
        };

        let status = bot
            .send_message(
                msg.chat.id,
                format!("Fetching Osmosis pool {pool_id} info..."),
            )
            .await?;

        if let Some(chain_info) = cache.get_chain(&chain).await? {
            match query_osmosis_pool_info(&chain_info.apis.grpc, &pool_id).await {
                Ok(pool) => {
                    edit_status_message(
                        &bot,
                        msg.chat.id,
                        status.id,
                        format_osmosis_pool_info(&pool_id, &pool),
                        None,
                    )
                    .await?;
                }
                Err(e) => {
                    edit_status_message(
                        &bot,
                        msg.chat.id,
                        status.id,
                        format!("Could not fetch Osmosis pool: {e}"),
                        None,
                    )
                    .await?;
                }
            }
        } else {
            edit_status_message(
                &bot,
                msg.chat.id,
                status.id,
                "Osmosis chain info not found.".to_string(),
                None,
            )
            .await?;
        }

        let new_menu_id = send_chain_menu(&bot, &msg, &chain).await?;
        dialogue
            .update(State::ChainSelected {
                chain: chain.clone(),
                message_id: Some(new_menu_id),
            })
            .await?;
    }
    Ok(())
}

pub async fn handle_osmosis_token_price(
    bot: Bot,
    dialogue: MyDialogue,
    cache: Arc<RegistryCache>,
    msg: Message,
    (chain, _message_id): (String, Option<MessageId>),
) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    if let Some(text) = msg.text() {
        let token = text.trim();
        if token.is_empty() {
            bot.send_message(
                msg.chat.id,
                "Please enter an Osmosis token symbol or base denom.",
            )
            .await?;
        } else {
            let status = bot
                .send_message(
                    msg.chat.id,
                    format!("Fetching Osmosis price for {token}..."),
                )
                .await?;

            if let Some(chain_info) = cache.get_chain(&chain).await? {
                match query_osmosis_token_price(&chain_info.apis.grpc, token).await {
                    Ok(price) => {
                        edit_status_message(
                            &bot,
                            msg.chat.id,
                            status.id,
                            format_osmosis_token_price(&price),
                            None,
                        )
                        .await?;
                    }
                    Err(e) => {
                        edit_status_message(
                            &bot,
                            msg.chat.id,
                            status.id,
                            format!("Could not fetch Osmosis price: {e}"),
                            None,
                        )
                        .await?;
                    }
                }
            } else {
                edit_status_message(
                    &bot,
                    msg.chat.id,
                    status.id,
                    "Osmosis chain info not found.".to_string(),
                    None,
                )
                .await?;
            }
        }

        let new_menu_id = send_chain_menu(&bot, &msg, &chain).await?;
        dialogue
            .update(State::ChainSelected {
                chain: chain.clone(),
                message_id: Some(new_menu_id),
            })
            .await?;
    }
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
                State::ChainSelected { chain, message_id } => {
                    let mut actions = if !chain.contains("testnet") {
                        vec![
                            "chain_info",
                            "peer_nodes",
                            "endpoints",
                            "explorers",
                            "ibc_id",
                            "ibc_route",
                            "check_balance",
                        ]
                    } else {
                        vec!["chain_info", "peer_nodes", "endpoints", "explorers"]
                    };
                    if is_osmosis_mainnet(&chain) {
                        actions.extend(["pool_incentives", "pool_info", "price_info"]);
                    }

                    if num > 0 && num <= actions.len() {
                        let action = actions[num - 1];

                        // Delete the previous menu if it exists
                        if let Some(menu_id) = message_id {
                            if let Err(e) = bot.delete_message(msg.chat.id, menu_id).await {
                                // Log error but continue - menu might already be deleted
                                eprintln!("Failed to delete menu: {}", e);
                            }
                        }

                        match action {
                            "chain_info" => {
                                let chain_data = cache.get_chain(&chain).await?;
                                let assets_data = cache.get_assets(&chain).await?;

                                if let (Some(chain_info), Some(assets)) = (chain_data, assets_data)
                                {
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

                                    let rpc = first_endpoint_address(&chain_info.apis.rpc);
                                    let rest = first_endpoint_address(&chain_info.apis.rest);

                                    let grpc = find_healthy_grpc_endpoint(&chain_info.apis.grpc)
                                        .await
                                        .unwrap_or_else(|| "Unknown".to_string());

                                    let explorer = chain_info
                                        .explorers
                                        .first()
                                        .map(|e| e.url.as_str())
                                        .unwrap_or("Unknown");

                                    // User-visible status queries should use gRPC; RPC/REST endpoints are displayed only.
                                    let abci_info = if grpc != "Unknown" {
                                        query_abci_info_grpc(&grpc).await
                                    } else {
                                        None
                                    };

                                    let mut message = format!(
                                        "🔗 *{}*\n\n\
                                        Chain ID: `{}`\n\
                                        Chain Name: `{}`\n\
                                        RPC: `{}`\n\
                                        REST: `{}`\n\
                                        GRPC: `{}`\n\
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
                                        escape_markdown(&grpc),
                                        escape_markdown(&chain_info.bech32_prefix),
                                        escape_markdown(base_denom),
                                        chain_info.slip44,
                                        decimals,
                                        escape_markdown(explorer)
                                    );

                                    // Append ABCI info if available
                                    if let Some(info) = abci_info {
                                        message.push_str(&format!(
                                            "\n\n*Node Status*\n\
                                            Version: `{}`\n\
                                            Latest Block: `{}`\n\
                                            App Hash: `{}`",
                                            escape_markdown(&info.version),
                                            escape_markdown(&info.last_block_height),
                                            escape_markdown(&info.last_block_app_hash)
                                        ));
                                    }

                                    bot.send_message(msg.chat.id, message)
                                        .parse_mode(ParseMode::MarkdownV2)
                                        .await?;
                                } else {
                                    bot.send_message(
                                        msg.chat.id,
                                        format!("Chain {} not found", chain),
                                    )
                                    .await?;
                                }
                                // Show menu again
                                let new_menu_id = send_chain_menu(&bot, &msg, &chain).await?;
                                dialogue
                                    .update(State::ChainSelected {
                                        chain: chain.clone(),
                                        message_id: Some(new_menu_id),
                                    })
                                    .await?;
                            }
                            "peer_nodes" => {
                                // Show peer nodes directly
                                let chain_data = cache.get_chain(&chain).await?;

                                if let Some(chain_info) = chain_data {
                                    let mut message = String::from(
                                        "*Seed Nodes*\n\\-\\-\\-\\-\\-\\-\\-\\-\\-\\-\n",
                                    );

                                    for seed in chain_info.peers.seeds.iter().take(5) {
                                        let provider =
                                            seed.provider.as_deref().unwrap_or("unknown");
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
                                    bot.send_message(
                                        msg.chat.id,
                                        format!("Chain {} not found", chain),
                                    )
                                    .await?;
                                }
                                // Show menu again
                                let new_menu_id = send_chain_menu(&bot, &msg, &chain).await?;
                                dialogue
                                    .update(State::ChainSelected {
                                        chain: chain.clone(),
                                        message_id: Some(new_menu_id),
                                    })
                                    .await?;
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
                                        let provider =
                                            rest.provider.as_deref().unwrap_or("unknown");
                                        message.push_str(&format!(
                                            "*{}*:\n`{}`\n\n",
                                            escape_markdown(provider),
                                            escape_markdown(&rest.address)
                                        ));
                                    }

                                    message.push_str("\n*GRPC*\n\\-\\-\\-\\-\n");

                                    for grpc in chain_info.apis.grpc.iter().take(5) {
                                        let provider =
                                            grpc.provider.as_deref().unwrap_or("unknown");
                                        message.push_str(&format!(
                                            "*{}*:\n`{}`\n\n",
                                            escape_markdown(provider),
                                            escape_markdown(&grpc.address)
                                        ));
                                    }

                                    if !chain_info.apis.evm_http_jsonrpc.is_empty() {
                                        message.push_str("\n*EVM RPC*\n\\-\\-\\-\\-\\-\\-\\-\\-\n");

                                        for evm_rpc in
                                            chain_info.apis.evm_http_jsonrpc.iter().take(5)
                                        {
                                            let provider =
                                                evm_rpc.provider.as_deref().unwrap_or("unknown");
                                            message.push_str(&format!(
                                                "*{}*:\n`{}`\n\n",
                                                escape_markdown(provider),
                                                escape_markdown(&evm_rpc.address)
                                            ));
                                        }
                                    }

                                    bot.send_message(msg.chat.id, message)
                                        .parse_mode(ParseMode::MarkdownV2)
                                        .await?;
                                } else {
                                    bot.send_message(
                                        msg.chat.id,
                                        format!("Chain {} not found", chain),
                                    )
                                    .await?;
                                }
                                // Show menu again
                                let new_menu_id = send_chain_menu(&bot, &msg, &chain).await?;
                                dialogue
                                    .update(State::ChainSelected {
                                        chain: chain.clone(),
                                        message_id: Some(new_menu_id),
                                    })
                                    .await?;
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
                                    bot.send_message(
                                        msg.chat.id,
                                        format!("Chain {} not found", chain),
                                    )
                                    .await?;
                                }
                                // Show menu again
                                let new_menu_id = send_chain_menu(&bot, &msg, &chain).await?;
                                dialogue
                                    .update(State::ChainSelected {
                                        chain: chain.clone(),
                                        message_id: Some(new_menu_id),
                                    })
                                    .await?;
                            }
                            "ibc_id" => {
                                dialogue
                                    .update(State::AwaitingIbcDenom {
                                        chain,
                                        message_id: Some(msg.id),
                                    })
                                    .await?;
                                bot.send_message(
                                    msg.chat.id,
                                    "Enter IBC denom (e.g., ibc/ABC123...):",
                                )
                                .await?;
                            }
                            "ibc_route" => {
                                dialogue
                                    .update(State::AwaitingIbcChannel {
                                        chain,
                                        message_id: Some(msg.id),
                                    })
                                    .await?;
                                bot.send_message(msg.chat.id, "Enter IBC channel (e.g., 0 or channel-0):\nOptionally add port (e.g., channel-0 transfer):").await?;
                            }
                            "check_balance" => {
                                dialogue
                                    .update(State::AwaitingWalletAddress {
                                        chain,
                                        message_id: Some(msg.id),
                                    })
                                    .await?;
                                bot.send_message(
                                    msg.chat.id,
                                    "Enter wallet address to check balance:",
                                )
                                .await?;
                            }
                            "pool_incentives" => {
                                dialogue
                                    .update(State::AwaitingOsmosisPoolIncentives {
                                        chain,
                                        message_id: Some(msg.id),
                                    })
                                    .await?;
                                bot.send_message(
                                    msg.chat.id,
                                    "Enter Osmosis pool ID for LP incentives:",
                                )
                                .await?;
                            }
                            "pool_info" => {
                                dialogue
                                    .update(State::AwaitingOsmosisPoolInfo {
                                        chain,
                                        message_id: Some(msg.id),
                                    })
                                    .await?;
                                bot.send_message(
                                    msg.chat.id,
                                    "Enter Osmosis pool ID for pool info:",
                                )
                                .await?;
                            }
                            "price_info" => {
                                dialogue
                                    .update(State::AwaitingOsmosisTokenTicker {
                                        chain,
                                        message_id: Some(msg.id),
                                    })
                                    .await?;
                                bot.send_message(
                                    msg.chat.id,
                                    "Enter Osmosis token symbol or base denom:",
                                )
                                .await?;
                            }
                            _ => {}
                        }
                    } else {
                        bot.send_message(msg.chat.id, "Invalid option number. Please try again.")
                            .await?;
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
                State::ChainSelected { chain, .. } | State::AwaitingIbcDenom { chain, .. } => {
                    let ibc_hash = &text[4..]; // Remove "ibc/" prefix

                    send_processing_action(&bot, msg.chat.id).await;
                    let status = bot
                        .send_message(msg.chat.id, format!("Resolving IBC denom on {chain}..."))
                        .await?;

                    if let Some(chain_info) = cache.get_chain(&chain).await? {
                        match query_ibc_denom_grpc_first(&chain_info.apis.grpc, ibc_hash).await {
                            Ok(trace) => {
                                let mut message = if !trace.path.is_empty() {
                                    format!(
                                        "✅ IBC Denom Trace Found:\n\nPath: {}\nBase Denomination: {}",
                                        trace.path, trace.base_denom
                                    )
                                } else {
                                    format!(
                                        "✅ IBC Denom Trace Found:\n\nBase Denomination: {}",
                                        trace.base_denom
                                    )
                                };

                                if !trace.path.is_empty() {
                                    if let Some(channel) = extract_channel_from_path(&trace.path) {
                                        match query_ibc_channel_info_grpc_first(
                                            &chain_info.apis.grpc,
                                            &channel,
                                            "transfer",
                                        )
                                        .await
                                        {
                                            Ok(info) => {
                                                message.push_str(&format!(
                                                    "\n\n📍 Source Chain: {}\nvia {}",
                                                    info.counterparty_chain_id, channel
                                                ));
                                            }
                                            Err(e) => {
                                                log::warn!(
                                                    "Could not fetch channel info for {}: {}",
                                                    channel,
                                                    e
                                                );
                                            }
                                        }
                                    }
                                }

                                edit_status_message(&bot, msg.chat.id, status.id, message, None)
                                    .await?;
                            }
                            Err(e) => {
                                let error_message = format!(
                                    "❌ Could not resolve IBC denom:\n{}\n\nThis denom might not exist on {} or the chain's APIs might be unavailable.",
                                    e, chain
                                );
                                edit_status_message(
                                    &bot,
                                    msg.chat.id,
                                    status.id,
                                    error_message,
                                    None,
                                )
                                .await?;
                            }
                        }
                    } else {
                        edit_status_message(
                            &bot,
                            msg.chat.id,
                            status.id,
                            "Chain not found".to_string(),
                            None,
                        )
                        .await?;
                    }
                    // Show menu again after IBC lookup
                    let new_menu_id = send_chain_menu(&bot, &msg, &chain).await?;
                    dialogue
                        .update(State::ChainSelected {
                            chain: chain.clone(),
                            message_id: Some(new_menu_id),
                        })
                        .await?;
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
            // Delete any previous menu if in chain selected state
            let state = dialogue.get().await?.unwrap_or_default();
            if let State::ChainSelected {
                message_id: Some(menu_id),
                ..
            } = state
            {
                if let Err(e) = bot.delete_message(msg.chat.id, menu_id).await {
                    eprintln!("Failed to delete previous menu: {}", e);
                }
            }

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

            // Add IBC options and balance check for mainnets
            // Check if it's a testnet by seeing if it's in the testnets list
            let testnets = cache.list_testnets().await.unwrap_or_default();
            if !testnets.iter().any(|t| t.to_lowercase() == text_lower) {
                buttons.push(vec![
                    InlineKeyboardButton::callback("5. IBC-ID", "action:ibc_id"),
                    InlineKeyboardButton::callback("6. IBC Route Info", "action:ibc_route"),
                ]);
                buttons.push(vec![InlineKeyboardButton::callback(
                    "7. Check Balance",
                    "action:check_balance",
                )]);
                if is_osmosis_mainnet(&text_lower) {
                    push_osmosis_buttons(&mut buttons);
                }
            }

            // Add installation guide link if available on Polkachu
            if let Some(install_url) = get_polkachu_installation_url(&text_lower) {
                buttons.push(vec![InlineKeyboardButton::url(
                    "Node Installation Guide",
                    install_url.parse().unwrap(),
                )]);
            }

            buttons.push(vec![InlineKeyboardButton::callback(
                "← Back",
                "back:chains",
            )]);

            let keyboard = InlineKeyboardMarkup::new(buttons);

            let sent_msg = bot
                .send_message(
                    msg.chat.id,
                    format!("Selected: {}\n\nChoose an action:", text_lower),
                )
                .reply_markup(keyboard)
                .await?;

            // Update dialogue with the new menu's message ID
            dialogue
                .update(State::ChainSelected {
                    chain: text_lower.clone(),
                    message_id: Some(sent_msg.id),
                })
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
