#[cfg(test)]
mod unit_tests {
    use crate::{
        bot::{MyDialogue, State},
        utils::{
            format_channel_input, format_osmosis_pool_incentives, format_osmosis_pool_info,
            format_osmosis_token_price, format_wallet_balances, prioritize_grpc_endpoints, Balance,
            IbcDenomTrace, OsmosisGaugeIncentive, OsmosisPoolIncentives, OsmosisTokenPrice,
            WalletBalance,
        },
    };
    use cosmos_chain_registry::chain;
    use serde_json::json;
    use teloxide::{
        dispatching::dialogue::InMemStorage,
        types::{ChatId, InlineKeyboardButton, MessageId},
    };

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
        dialogue
            .update(State::SelectingChain {
                page: 0,
                is_testnet: false,
                message_id: None,
                last_selected_chain: None,
            })
            .await
            .unwrap();

        let state = dialogue.get().await.unwrap().unwrap();
        assert!(matches!(state, State::SelectingChain { .. }));

        // Test transition to ChainSelected
        dialogue
            .update(State::ChainSelected {
                chain: "osmosis".to_string(),
                message_id: None,
            })
            .await
            .unwrap();

        let state = dialogue.get().await.unwrap().unwrap();
        assert!(matches!(state, State::ChainSelected { .. }));

        // Test transition to AwaitingIbcDenom
        dialogue
            .update(State::AwaitingIbcDenom {
                chain: "osmosis".to_string(),
                message_id: None,
            })
            .await
            .unwrap();

        let state = dialogue.get().await.unwrap().unwrap();
        assert!(matches!(state, State::AwaitingIbcDenom { .. }));

        dialogue
            .update(State::AwaitingOsmosisPoolInfo {
                chain: "osmosis".to_string(),
                message_id: None,
            })
            .await
            .unwrap();

        let state = dialogue.get().await.unwrap().unwrap();
        assert!(matches!(state, State::AwaitingOsmosisPoolInfo { .. }));

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
        assert_eq!(
            page_data.strip_prefix("page:").unwrap().parse::<usize>(),
            Ok(2)
        );

        // Test toggle testnet callback
        let toggle_data = "toggle_testnet:true";
        assert_eq!(toggle_data.strip_prefix("toggle_testnet:"), Some("true"));
        assert_eq!(
            toggle_data
                .strip_prefix("toggle_testnet:")
                .unwrap()
                .parse::<bool>(),
            Ok(true)
        );

        // Test action callbacks
        let action_data = "action:chain_info";
        assert_eq!(action_data, "action:chain_info");

        // Test back navigation
        let back_data = "back:chains";
        assert_eq!(back_data, "back:chains");
    }

    #[tokio::test]
    async fn test_numeric_menu_selection() {
        let actions = [
            "chain_info",
            "peer_nodes",
            "endpoints",
            "explorers",
            "ibc_id",
        ];

        // Test valid selections
        for num in 1..=5 {
            assert!(num > 0 && num <= actions.len());
            assert_eq!(
                actions[num - 1],
                match num {
                    1 => "chain_info",
                    2 => "peer_nodes",
                    3 => "endpoints",
                    4 => "explorers",
                    5 => "ibc_id",
                    _ => panic!("Unexpected number"),
                }
            );
        }

        // Test invalid selections
        assert!(actions.get(0_usize.wrapping_sub(1)).is_none());
        assert!(actions.get(5).is_none());
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
        let chains = [
            "osmosis".to_string(),
            "cosmoshub".to_string(),
            "juno".to_string(),
            "osmosistestnet".to_string(),
        ];

        // Test exact matches (case insensitive)
        let input = "osmosis";
        assert!(chains
            .iter()
            .any(|c| c.to_lowercase() == input.to_lowercase()));

        let input = "COSMOSHUB";
        assert!(chains
            .iter()
            .any(|c| c.to_lowercase() == input.to_lowercase()));

        // Test non-matches
        let input = "invalid_chain";
        assert!(!chains
            .iter()
            .any(|c| c.to_lowercase() == input.to_lowercase()));

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
        let chains = ["osmosis", "juno", "axelar", "stride", "noble"];
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
        let total_pages = chains.len().div_ceil(page_size);
        assert_eq!(total_pages, 2);

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

        if let State::SelectingChain {
            page,
            is_testnet,
            message_id,
            last_selected_chain,
        } = state
        {
            assert_eq!(page, 1);
            assert!(!is_testnet);
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

    #[test]
    fn test_channel_input_formatting() {
        assert_eq!(format_channel_input("0"), "channel-0");
        assert_eq!(format_channel_input("channel-23"), "channel-23");
        assert_eq!(format_channel_input("transfer"), "transfer");
    }

    #[test]
    fn test_osmosis_pool_info_formatting() {
        let pool = json!({
            "@type": "/osmosis.gamm.v1beta1.Pool",
            "address": "osmo1pool",
            "pool_params": {"swap_fee": "0.002000000000000000"},
            "total_shares": {"amount": "1234567890"},
            "pool_assets": [
                {"token": {"denom": "uosmo", "amount": "1000000"}, "weight": "50"},
                {"token": {"denom": "ibc/1234567890ABCDEF", "amount": "2000000"}, "weight": "50"}
            ]
        });

        let formatted = format_osmosis_pool_info("1", &pool);

        assert!(formatted.contains("Osmosis Pool 1"));
        assert!(formatted.contains("Type: Pool"));
        assert!(formatted.contains("uosmo: 1,000,000"));
        assert!(formatted.contains("ibc/12345678..."));
    }

    #[test]
    fn test_osmosis_pool_incentives_formatting() {
        let incentives = OsmosisPoolIncentives {
            gauges: vec![OsmosisGaugeIncentive {
                gauge_id: "1".to_string(),
                duration: "86400s".to_string(),
                incentive_percentage: "0.100000000000000000".to_string(),
                coins: vec![Balance {
                    denom: "uosmo".to_string(),
                    amount: "1000000".to_string(),
                }],
                distributed_coins: vec![],
            }],
            cl_records: vec![],
        };

        let formatted = format_osmosis_pool_incentives("1", &incentives);

        assert!(formatted.contains("Gauge 1"));
        assert!(formatted.contains("1,000,000 uosmo"));
        assert!(formatted.contains("distributed: none"));
    }

    #[test]
    fn test_osmosis_token_price_formatting() {
        let price = OsmosisTokenPrice {
            name: "Osmosis".to_string(),
            symbol: "OSMO".to_string(),
            denom: "uosmo".to_string(),
            quote_symbol: "USDC".to_string(),
            quote_denom: "ibc/498A0751C798A0D9".to_string(),
            price: "0.037".to_string(),
        };

        let formatted = format_osmosis_token_price(&price);

        assert!(formatted.contains("Token: Osmosis (OSMO)"));
        assert!(formatted.contains("Price: 0.037 USDC"));
        assert!(formatted.contains("ibc/498A0751..."));
    }

    #[test]
    fn test_prioritize_grpc_endpoints_prefers_polkachu_https() {
        let endpoints = vec![
            chain::Grpc {
                address: "http://insecure.example:9090".to_string(),
                provider: Some("Insecure".to_string()),
            },
            chain::Grpc {
                address: "community-grpc.example:443".to_string(),
                provider: Some("Community".to_string()),
            },
            chain::Grpc {
                address: "osmosis-grpc.polkachu.com:12590".to_string(),
                provider: Some("Polkachu".to_string()),
            },
        ];

        let prioritized = prioritize_grpc_endpoints(&endpoints);

        assert_eq!(
            prioritized,
            vec![
                "https://osmosis-grpc.polkachu.com:12590/".to_string(),
                "https://community-grpc.example:443/".to_string()
            ]
        );
    }

    #[test]
    fn test_wallet_balance_formatting_separates_copyable_ibc_fields() {
        let balances = vec![
            WalletBalance {
                balance: Balance {
                    denom: "ibc/23B7FFE8D1673E1EBF05AB02000E23E6077967B79547A3733B60AE4ED62C4D32"
                        .to_string(),
                    amount: "10000000".to_string(),
                },
                ibc_trace: Some(IbcDenomTrace {
                    path: "transfer/channel-123/transfer/channel-42".to_string(),
                    base_denom: "loki".to_string(),
                }),
                asset_label: Some("LOKI".to_string()),
            },
            WalletBalance {
                balance: Balance {
                    denom: "factory/osmo1n6asrjy9754q8y9jsxqf557zmsv3s3xa5m9eg5/uspice".to_string(),
                    amount: "999999".to_string(),
                },
                ibc_trace: None,
                asset_label: Some("SPICE".to_string()),
            },
        ];

        let formatted =
            format_wallet_balances("osmo1wev8ptzj27aueu0abc", "osmosis", &balances, true);

        assert!(formatted.contains("*Balances for* `osmo1wev8ptzj27aueu0...`"));
        assert!(formatted.contains("*LOKI*"));
        assert!(formatted.contains("Amount: `10,000,000`"));
        assert!(formatted.contains(
            "IBC Denom: `ibc/23B7FFE8D1673E1EBF05AB02000E23E6077967B79547A3733B60AE4ED62C4D32`"
        ));
        assert!(formatted.contains("IBC Path: `transfer/channel-123/transfer/channel-42`"));
        assert!(formatted.contains("Base Denom: `loki`"));
        assert!(formatted.contains("*SPICE*"));
        assert!(formatted.contains("Amount: `999,999`"));
        assert!(formatted
            .contains("Denom: `factory/osmo1n6asrjy9754q8y9jsxqf557zmsv3s3xa5m9eg5/uspice`"));
        assert!(formatted.contains("_Showing first 100 assets; more balances are available\\._"));
    }
}
