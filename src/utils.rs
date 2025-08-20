use reqwest;
use serde_json::Value;
use std::time::{SystemTime, UNIX_EPOCH};

pub const PAGE_SIZE: usize = 18;

pub async fn check_endpoint_health(endpoint: &str, is_rpc: bool) -> bool {
    if endpoint.starts_with("http://") || endpoint.is_empty() {
        return false;
    }

    let url = if is_rpc {
        format!("{}/status", endpoint.trim_end_matches('/'))
    } else {
        format!(
            "{}/cosmos/base/tendermint/v1beta1/blocks/latest",
            endpoint.trim_end_matches('/')
        )
    };

    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(5))
        .build()
        .unwrap();

    match client.get(&url).send().await {
        Ok(response) if response.status().is_success() => {
            match response.json::<Value>().await {
                Ok(json) => {
                    let block_time = if is_rpc {
                        json["result"]["sync_info"]["latest_block_time"]
                            .as_str()
                            .or_else(|| json["sync_info"]["latest_block_time"].as_str())
                    } else {
                        json["block"]["header"]["time"].as_str()
                    };

                    if let Some(time_str) = block_time {
                        if let Ok(block_time) = chrono::DateTime::parse_from_rfc3339(time_str) {
                            let now = chrono::Utc::now();
                            let diff = now.timestamp() - block_time.timestamp();
                            return diff < 60; // Block is less than 60 seconds old
                        }
                    }
                    false
                }
                Err(_) => false,
            }
        }
        _ => false,
    }
}

pub async fn find_healthy_endpoint(
    endpoints: &[chain_registry::chain::Rpc],
    is_rpc: bool,
) -> Option<String> {
    for endpoint in endpoints {
        if check_endpoint_health(&endpoint.address, is_rpc).await {
            return Some(endpoint.address.clone());
        }
    }
    None
}

pub async fn find_healthy_rest_endpoint(
    endpoints: &[chain_registry::chain::Rest],
) -> Option<String> {
    for endpoint in endpoints {
        if check_endpoint_health(&endpoint.address, false).await {
            return Some(endpoint.address.clone());
        }
    }
    None
}

pub async fn query_ibc_denom(
    rest_endpoint: &str,
    ibc_hash: &str,
) -> anyhow::Result<(String, String)> {
    let url = format!(
        "{}/ibc/apps/transfer/v1/denom_traces/{}",
        rest_endpoint.trim_end_matches('/'),
        ibc_hash
    );

    let response = reqwest::get(&url).await?;
    let json: Value = response.json().await?;

    if let Some(trace) = json["denom_trace"].as_object() {
        let path = trace["path"].as_str().unwrap_or("");
        let base_denom = trace["base_denom"].as_str().unwrap_or(ibc_hash);
        Ok((path.to_string(), base_denom.to_string()))
    } else {
        Ok(("".to_string(), ibc_hash.to_string()))
    }
}

pub fn escape_markdown(text: &str) -> String {
    text.chars()
        .map(|c| match c {
            '_' | '*' | '[' | ']' | '(' | ')' | '~' | '`' | '>' | '#' | '+' | '-' | '=' | '|'
            | '{' | '}' | '.' | '!' => format!("\\{}", c),
            _ => c.to_string(),
        })
        .collect()
}