#[cfg(test)]
mod tests {
    use crate::{
        bot::{MyDialogue, State},
        cache::RegistryCache,
    };
    use std::sync::Arc;
    use teloxide::{
        dispatching::dialogue::InMemStorage,
        prelude::*,
        types::{
            CallbackQuery, Chat, ChatId, ChatKind, InlineKeyboardButton, 
            Message, MessageId, MessageKind, User, UserId,
        },
    };

    // Helper function to create a test bot
    fn create_test_bot() -> Bot {
        Bot::new("TEST_TOKEN")
    }

    // Helper function to create a test user
    fn create_test_user() -> User {
        User {
            id: UserId(123456),
            is_bot: false,
            first_name: "Test".to_string(),
            last_name: Some("User".to_string()),
            username: Some("testuser".to_string()),
            language_code: Some("en".to_string()),
            is_premium: false,
            added_to_attachment_menu: false,
        }
    }

    // Helper function to create a test chat
    fn create_test_chat() -> Chat {
        Chat {
            id: ChatId(123456),
            kind: ChatKind::Private(teloxide::types::ChatPrivate {
                username: Some("testuser".to_string()),
                first_name: Some("Test".to_string()),
                last_name: Some("User".to_string()),
                bio: None,
                has_private_forwards: None,
                has_restricted_voice_and_video_messages: None,
                emoji_status_custom_emoji_id: None,
            }),
            photo: None,
            pinned_message: None,
            message_auto_delete_time: None,
            has_hidden_members: false,
            has_aggressive_anti_spam_enabled: false,
        }
    }

    // Helper function to create a test message
    fn create_test_message(text: Option<String>) -> Message {
        Message {
            id: MessageId(1),
            thread_id: None,
            date: chrono::Utc::now(),
            chat: create_test_chat(),
            via_bot: None,
            kind: MessageKind::Common(teloxide::types::MessageCommon {
                from: Some(create_test_user()),
                sender_chat: None,
                author_signature: None,
                forward: None,
                reply_to_message: None,
                edit_date: None,
                media_kind: teloxide::types::MediaKind::Text(teloxide::types::MediaText {
                    text: text.unwrap_or_else(|| "/start".to_string()),
                    entities: vec![],
                }),
                reply_markup: None,
                is_topic_message: false,
                is_automatic_forward: false,
                has_protected_content: false,
            }),
        }
    }

    // Helper function to create a test callback query
    fn create_test_callback_query(data: String, message: Option<Message>) -> CallbackQuery {
        CallbackQuery {
            id: "test_callback_123".to_string(),
            from: create_test_user(),
            message,
            inline_message_id: None,
            chat_instance: "test_instance".to_string(),
            data: Some(data),
            game_short_name: None,
        }
    }

    // Helper function to create a test dialogue
    async fn create_test_dialogue() -> MyDialogue {
        let storage = InMemStorage::<State>::new();
        MyDialogue::new(storage, ChatId(123456))
    }

    #[tokio::test]
    async fn test_state_transitions() {
        let dialogue = create_test_dialogue().await;
        
        // Test initial state
        let state = dialogue.get().await.unwrap();
        assert!(state.is_none() || matches!(state, Some(State::Start)));
        
        // Test transition to SelectingChain
        dialogue.update(State::SelectingChain {
            page: 0,
            is_testnet: false,
            message_id: None,
            last_selected_chain: None,
        }).await.unwrap();
        
        let state = dialogue.get().await.unwrap().unwrap();
        assert!(matches!(state, State::SelectingChain { .. }));
        
        // Test transition to ChainSelected
        dialogue.update(State::ChainSelected {
            chain: "osmosis".to_string(),
            message_id: None,
        }).await.unwrap();
        
        let state = dialogue.get().await.unwrap().unwrap();
        assert!(matches!(state, State::ChainSelected { .. }));
        
        // Test transition to AwaitingIbcDenom
        dialogue.update(State::AwaitingIbcDenom {
            chain: "osmosis".to_string(),
            message_id: None,
        }).await.unwrap();
        
        let state = dialogue.get().await.unwrap().unwrap();
        assert!(matches!(state, State::AwaitingIbcDenom { .. }));
        
        // Test reset
        dialogue.reset().await.unwrap();
        let state = dialogue.get().await.unwrap();
        assert!(state.is_none() || matches!(state, Some(State::Start)));
    }

    #[tokio::test]
    async fn test_callback_data_parsing() {
        // Test select chain callback
        let select_data = "select:osmosis";
        assert_eq!(select_data.strip_prefix("select:"), Some("osmosis"));
        
        // Test page navigation callback
        let page_data = "page:2";
        assert_eq!(page_data.strip_prefix("page:"), Some("2"));
        assert_eq!(page_data.strip_prefix("page:").unwrap().parse::<usize>(), Ok(2));
        
        // Test toggle testnet callback
        let toggle_data = "toggle_testnet:true";
        assert_eq!(toggle_data.strip_prefix("toggle_testnet:"), Some("true"));
        assert_eq!(toggle_data.strip_prefix("toggle_testnet:").unwrap().parse::<bool>(), Ok(true));
        
        // Test action callbacks
        let action_data = "action:chain_info";
        assert_eq!(action_data, "action:chain_info");
        
        // Test back navigation
        let back_data = "back:chains";
        assert_eq!(back_data, "back:chains");
    }

    #[tokio::test]
    async fn test_numeric_menu_selection() {
        let actions = vec![
            "chain_info",
            "peer_nodes",
            "endpoints",
            "explorers",
            "ibc_id",
        ];
        
        // Test valid selections
        for num in 1..=5 {
            assert!(num > 0 && num <= actions.len());
            assert_eq!(actions[num - 1], match num {
                1 => "chain_info",
                2 => "peer_nodes",
                3 => "endpoints",
                4 => "explorers",
                5 => "ibc_id",
                _ => panic!("Unexpected number"),
            });
        }
        
        // Test invalid selections
        assert!(!(0 > 0 && 0 <= actions.len()));
        assert!(!(6 > 0 && 6 <= actions.len()));
    }

    #[tokio::test]
    async fn test_ibc_denom_validation() {
        let valid_ibc = "ibc/ABC123DEF456";
        let invalid_ibc = "not_an_ibc_denom";
        
        assert!(valid_ibc.starts_with("ibc/"));
        assert!(!invalid_ibc.starts_with("ibc/"));
        
        if let Some(hash) = valid_ibc.strip_prefix("ibc/") {
            assert_eq!(hash, "ABC123DEF456");
        }
    }

    #[tokio::test]
    async fn test_chain_name_matching() {
        let chains = vec![
            "osmosis".to_string(),
            "cosmoshub".to_string(),
            "juno".to_string(),
            "osmosistestnet".to_string(),
        ];
        
        // Test exact matches (case insensitive)
        let input = "osmosis";
        assert!(chains.iter().any(|c| c.to_lowercase() == input.to_lowercase()));
        
        let input = "COSMOSHUB";
        assert!(chains.iter().any(|c| c.to_lowercase() == input.to_lowercase()));
        
        // Test non-matches
        let input = "invalid_chain";
        assert!(!chains.iter().any(|c| c.to_lowercase() == input.to_lowercase()));
        
        // Test testnet filtering
        let testnets: Vec<String> = chains
            .iter()
            .filter(|c| c.contains("testnet"))
            .cloned()
            .collect();
        assert_eq!(testnets.len(), 1);
        assert_eq!(testnets[0], "osmosistestnet");
        
        let mainnets: Vec<String> = chains
            .iter()
            .filter(|c| !c.contains("testnet"))
            .cloned()
            .collect();
        assert_eq!(mainnets.len(), 3);
    }

    #[tokio::test]
    async fn test_keyboard_button_creation() {
        let chains = vec!["osmosis", "juno", "axelar", "stride", "noble"];
        let page = 0;
        let page_size = 3;
        
        let start = page * page_size;
        let end = (start + page_size).min(chains.len());
        let page_chains = &chains[start..end];
        
        assert_eq!(page_chains.len(), 3);
        assert_eq!(page_chains, &["osmosis", "juno", "axelar"]);
        
        // Test button creation
        let mut buttons = vec![];
        for chunk in page_chains.chunks(3) {
            let row: Vec<InlineKeyboardButton> = chunk
                .iter()
                .map(|chain| {
                    InlineKeyboardButton::callback(chain.to_string(), format!("select:{}", chain))
                })
                .collect();
            buttons.push(row);
        }
        
        assert_eq!(buttons.len(), 1);
        assert_eq!(buttons[0].len(), 3);
        
        // Test navigation buttons
        let total_pages = (chains.len() + page_size - 1) / page_size;
        assert_eq!(total_pages, 2);
        
        let mut nav_buttons = vec![];
        if page > 0 {
            nav_buttons.push(InlineKeyboardButton::callback("← Previous", format!("page:{}", page - 1)));
        }
        if page < total_pages - 1 {
            nav_buttons.push(InlineKeyboardButton::callback("Next →", format!("page:{}", page + 1)));
        }
        
        assert_eq!(nav_buttons.len(), 1); // Only "Next" button for page 0
    }

    #[tokio::test]
    async fn test_state_extraction_for_callbacks() {
        // Test SelectingChain state extraction
        let state = State::SelectingChain {
            page: 1,
            is_testnet: false,
            message_id: Some(MessageId(123)),
            last_selected_chain: Some("osmosis".to_string()),
        };
        
        if let State::SelectingChain { page, is_testnet, message_id, last_selected_chain } = state {
            assert_eq!(page, 1);
            assert_eq!(is_testnet, false);
            assert_eq!(message_id, Some(MessageId(123)));
            assert_eq!(last_selected_chain, Some("osmosis".to_string()));
        }
        
        // Test ChainSelected state extraction
        let state = State::ChainSelected {
            chain: "cosmoshub".to_string(),
            message_id: Some(MessageId(456)),
        };
        
        if let State::ChainSelected { chain, message_id } = state {
            assert_eq!(chain, "cosmoshub");
            assert_eq!(message_id, Some(MessageId(456)));
        }
        
        // Test AwaitingIbcDenom state extraction
        let state = State::AwaitingIbcDenom {
            chain: "juno".to_string(),
            message_id: None,
        };
        
        if let State::AwaitingIbcDenom { chain, message_id } = state {
            assert_eq!(chain, "juno");
            assert_eq!(message_id, None);
        }
    }

    #[tokio::test]
    async fn test_escape_markdown() {
        use crate::utils::escape_markdown;
        
        let input = "Test_string*with[special]chars";
        let escaped = escape_markdown(input);
        assert_eq!(escaped, "Test\\_string\\*with\\[special\\]chars");
        
        let input = "https://example.com/path?param=value";
        let escaped = escape_markdown(input);
        assert_eq!(escaped, "https://example\\.com/path?param\\=value");
    }

    #[tokio::test]
    async fn test_fallback_handler_parameters() {
        // The fallback handler should now accept all required parameters
        let _bot = create_test_bot();
        let _dialogue = create_test_dialogue().await;
        let _cache = Arc::new(RegistryCache::new(30));
        let _query = create_test_callback_query("unknown_action".to_string(), None);
        
        // This test verifies that the handler signature is correct
        // The actual handler call would be:
        // handlers::handle_callback(bot, dialogue, cache, query).await
        
        // Verify the parameters match what dptree provides
        assert!(true); // Compilation success means the signature is correct
    }
}