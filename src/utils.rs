use reqwest;
use serde_json::Value;
use serde::{Deserialize, Serialize};
use cosmos_chain_registry::chain;
use std::collections::HashMap;

pub const PAGE_SIZE: usize = 18;

/// Returns the Polkachu installation guide URL for a chain if supported
pub fn get_polkachu_installation_url(chain_name: &str) -> Option<String> {
    // Map chain registry names to Polkachu URL slugs
    let special_mappings: HashMap<&str, &str> = [
        ("cosmoshub", "cosmos"),
        ("fetchhub", "fetch"),
        ("elysnetwork", "elys"),
        ("elys", "elys"),
        ("hippo", "hippo"),
    ].into_iter().collect();

    // All supported chains on Polkachu (verified working)
    let supported: std::collections::HashSet<&str> = [
        "axelar", "babylon", "celestia", "cosmos", "dydx", "initia",
        "injective", "osmosis", "sei", "akash", "allora", "althea",
        "andromeda", "archway", "arkeo", "atomone", "aura", "band",
        "bitcanna", "bitsong", "bitway", "canto", "chain4energy", "cheqd",
        "chihuahua", "comdex", "crescent", "cronos", "decentr", "dhealth",
        "dymension", "elys", "evmos", "fetch", "functionx", "gitopia",
        "gravity", "haqq", "hippo", "humans", "intento", "jackal", "juno",
        "kava", "kichain", "kopi", "kujira", "kyve", "loyal", "lum",
        "lumera", "mantra", "meme", "milkyway", "neutron", "nibiru",
        "nillion", "noble", "nolus", "nym", "odin", "omniflix", "passage",
        "persistence", "picasso", "planq", "provenance", "quicksilver",
        "saga", "shentu", "shido", "sifchain", "sommelier", "source",
        "stargaze", "stride", "sunrise", "symphony", "tacchain", "teritori",
        "terra", "umee", "ununifi", "xpla",
    ].into_iter().collect();

    let chain_lower = chain_name.to_lowercase();

    // Check for special mapping first
    let slug = special_mappings.get(chain_lower.as_str())
        .map(|s| s.to_string())
        .unwrap_or_else(|| chain_lower.clone());

    if supported.contains(slug.as_str()) {
        Some(format!("https://polkachu.com/installation/{}", slug))
    } else {
        None
    }
}

#[derive(Debug, Serialize, Deserialize)]
pub struct IbcChannelInfo {
    pub chain_id: String,
    pub counterparty_chain_id: String,
    pub client_id: String,
    pub connection_id: String,
    pub counterparty_client_id: String,
    pub counterparty_connection_id: String,
    pub channel_id: String,
    pub counterparty_channel_id: String,
}

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
    endpoints: &[chain::Rpc],
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
    endpoints: &[chain::Rest],
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
    // First try the standard endpoint
    let url = format!(
        "{}/ibc/apps/transfer/v1/denom_traces/{}",
        rest_endpoint.trim_end_matches('/'),
        ibc_hash
    );

    log::info!("Querying IBC denom trace at: {}", url);

    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(10))
        .build()?;

    let response = client.get(&url).send().await?;

    // Check if the request was successful
    if !response.status().is_success() {
        // Try the alternate endpoint /denoms/{hash} for chains that use it
        let alt_url = format!(
            "{}/ibc/apps/transfer/v1/denoms/{}",
            rest_endpoint.trim_end_matches('/'),
            ibc_hash
        );

        log::info!("Trying alternate endpoint: {}", alt_url);

        let alt_response = client.get(&alt_url).send().await?;

        if !alt_response.status().is_success() {
            return Err(anyhow::anyhow!(
                "IBC denom query failed. The denom might not exist on this chain or the API might be unavailable."
            ));
        }

        let json: Value = alt_response.json().await?;
        log::debug!("IBC denom response (alternate): {}", json);

        // Parse the alternate response format which has denom directly
        if let Some(denom) = json["denom"].as_object() {
            // The alternate format has "base" instead of "base_denom"
            // and "trace" array instead of "path"
            let base_denom = denom.get("base")
                .and_then(|v| v.as_str())
                .ok_or_else(|| anyhow::anyhow!("Missing base in alternate response"))?;

            // Reconstruct path from trace array
            let path = if let Some(trace) = denom.get("trace").and_then(|v| v.as_array()) {
                trace.iter()
                    .filter_map(|entry| {
                        let port = entry["port_id"].as_str()?;
                        let channel = entry["channel_id"].as_str()?;
                        Some(format!("{}/{}", port, channel))
                    })
                    .collect::<Vec<_>>()
                    .join("/")
            } else {
                String::new()
            };

            return Ok((path, base_denom.to_string()));
        }

        return Err(anyhow::anyhow!("Invalid response format from alternate endpoint"));
    }

    let json: Value = response.json().await?;
    log::debug!("IBC denom trace response: {}", json);

    // Parse the standard response format
    if let Some(trace) = json["denom_trace"].as_object() {
        let path = trace.get("path")
            .and_then(|v| v.as_str())
            .unwrap_or("");
        let base_denom = trace.get("base_denom")
            .and_then(|v| v.as_str())
            .ok_or_else(|| anyhow::anyhow!("Missing base_denom in response"))?;

        return Ok((path.to_string(), base_denom.to_string()));
    }

    // If denom_trace is not found in the expected format
    Err(anyhow::anyhow!("Invalid response format: missing denom_trace"))
}

pub async fn query_ibc_denom_with_fallback(
    endpoints: &[chain::Rest],
    ibc_hash: &str,
) -> anyhow::Result<(String, String)> {
    let mut last_error = None;
    let max_attempts = 3.min(endpoints.len());

    for endpoint in endpoints.iter().take(max_attempts) {
        // Skip non-HTTPS endpoints
        if endpoint.address.starts_with("http://") || endpoint.address.is_empty() {
            continue;
        }

        log::info!("Trying REST endpoint: {}", endpoint.address);

        match query_ibc_denom(&endpoint.address, ibc_hash).await {
            Ok(result) => return Ok(result),
            Err(e) => {
                log::warn!("Failed with endpoint {}: {}", endpoint.address, e);
                last_error = Some(e);
            }
        }
    }

    Err(last_error.unwrap_or_else(|| anyhow::anyhow!("No valid REST endpoints available")))
}

pub async fn query_ibc_channel_info(
    rest_endpoint: &str,
    channel_id: &str,
    port_id: &str,
) -> anyhow::Result<IbcChannelInfo> {
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(10))
        .build()?;

    let base_url = rest_endpoint.trim_end_matches('/');

    // Fetch chain ID
    let chain_info_url = format!("{}/cosmos/base/tendermint/v1beta1/node_info", base_url);
    log::info!("Fetching chain ID from: {}", chain_info_url);

    let response = client.get(&chain_info_url).send().await?;
    if !response.status().is_success() {
        return Err(anyhow::anyhow!("Failed to fetch chain info"));
    }
    let chain_info: Value = response.json().await?;
    let chain_id = chain_info["default_node_info"]["network"]
        .as_str()
        .ok_or_else(|| anyhow::anyhow!("Chain ID not found"))?
        .to_string();

    // Fetch channel data
    let channel_url = format!("{}/ibc/core/channel/v1/channels/{}/ports/{}", base_url, channel_id, port_id);
    log::info!("Fetching channel data from: {}", channel_url);

    let response = client.get(&channel_url).send().await?;
    if !response.status().is_success() {
        return Err(anyhow::anyhow!("Channel {} not found on port {}", channel_id, port_id));
    }
    let channel_data: Value = response.json().await?;

    let counterparty_channel_id = channel_data["channel"]["counterparty"]["channel_id"]
        .as_str()
        .ok_or_else(|| anyhow::anyhow!("Counterparty channel ID not found"))?
        .to_string();

    let connection_id = channel_data["channel"]["connection_hops"][0]
        .as_str()
        .ok_or_else(|| anyhow::anyhow!("Connection ID not found"))?
        .to_string();

    // Fetch connection data
    let connection_url = format!("{}/ibc/core/connection/v1/connections/{}", base_url, connection_id);
    log::info!("Fetching connection data from: {}", connection_url);

    let response = client.get(&connection_url).send().await?;
    if !response.status().is_success() {
        return Err(anyhow::anyhow!("Connection {} not found", connection_id));
    }
    let connection_data: Value = response.json().await?;

    let client_id = connection_data["connection"]["client_id"]
        .as_str()
        .ok_or_else(|| anyhow::anyhow!("Client ID not found"))?
        .to_string();

    let counterparty_client_id = connection_data["connection"]["counterparty"]["client_id"]
        .as_str()
        .ok_or_else(|| anyhow::anyhow!("Counterparty client ID not found"))?
        .to_string();

    let counterparty_connection_id = connection_data["connection"]["counterparty"]["connection_id"]
        .as_str()
        .ok_or_else(|| anyhow::anyhow!("Counterparty connection ID not found"))?
        .to_string();

    // Fetch counterparty chain ID
    let client_state_url = format!("{}/ibc/core/channel/v1/channels/{}/ports/{}/client_state",
                                   base_url, channel_id, port_id);
    log::info!("Fetching counterparty chain ID from: {}", client_state_url);

    let response = client.get(&client_state_url).send().await?;
    if !response.status().is_success() {
        return Err(anyhow::anyhow!("Failed to fetch client state"));
    }
    let client_state: Value = response.json().await?;

    let counterparty_chain_id = client_state["identified_client_state"]["client_state"]["chain_id"]
        .as_str()
        .ok_or_else(|| anyhow::anyhow!("Counterparty chain ID not found"))?
        .to_string();

    Ok(IbcChannelInfo {
        chain_id,
        counterparty_chain_id,
        client_id,
        connection_id,
        counterparty_client_id,
        counterparty_connection_id,
        channel_id: channel_id.to_string(),
        counterparty_channel_id,
    })
}

pub async fn query_ibc_channel_info_with_fallback(
    endpoints: &[chain::Rest],
    channel_id: &str,
    port_id: &str,
) -> anyhow::Result<IbcChannelInfo> {
    let mut last_error = None;
    let max_attempts = 3.min(endpoints.len());

    for endpoint in endpoints.iter().take(max_attempts) {
        // Skip non-HTTPS endpoints
        if endpoint.address.starts_with("http://") || endpoint.address.is_empty() {
            continue;
        }

        log::info!("Trying REST endpoint for channel info: {}", endpoint.address);

        match query_ibc_channel_info(&endpoint.address, channel_id, port_id).await {
            Ok(result) => return Ok(result),
            Err(e) => {
                log::warn!("Failed with endpoint {}: {}", endpoint.address, e);
                last_error = Some(e);
            }
        }
    }

    Err(last_error.unwrap_or_else(|| anyhow::anyhow!("No valid REST endpoints available for channel query")))
}

pub fn extract_channel_from_path(path: &str) -> Option<String> {
    // Parse IBC path like "transfer/channel-23/transfer/channel-0"
    // We want to extract the first channel after "transfer/"
    let parts: Vec<&str> = path.split('/').collect();

    for (i, part) in parts.iter().enumerate() {
        if *part == "transfer" && i + 1 < parts.len() {
            let channel = parts[i + 1];
            if channel.starts_with("channel-") {
                return Some(channel.to_string());
            }
        }
    }
    None
}

pub fn format_channel_input(input: &str) -> String {
    // If user enters just a number, format it as channel-N
    // If user enters channel-N, use as is
    if input.starts_with("channel-") {
        input.to_string()
    } else if input.parse::<u32>().is_ok() {
        format!("channel-{}", input)
    } else {
        input.to_string()
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

/// ABCI info response containing version and block data
#[derive(Debug, Clone)]
pub struct AbciInfo {
    pub version: String,
    pub last_block_height: String,
    pub last_block_app_hash: String,
}

/// Query the ABCI info endpoint to get the chain's software version and block info
pub async fn query_abci_info(rpc_endpoint: &str) -> Option<AbciInfo> {
    let url = format!("{}/abci_info", rpc_endpoint.trim_end_matches('/'));

    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(5))
        .build()
        .ok()?;

    let response = client.get(&url).send().await.ok()?;

    if !response.status().is_success() {
        return None;
    }

    let json: Value = response.json().await.ok()?;

    let resp = &json["result"]["response"];

    Some(AbciInfo {
        version: resp["version"].as_str().unwrap_or("Unknown").to_string(),
        last_block_height: resp["last_block_height"].as_str().unwrap_or("Unknown").to_string(),
        last_block_app_hash: resp["last_block_app_hash"].as_str().unwrap_or("Unknown").to_string(),
    })
}

/// Balance entry from bank query
#[derive(Debug, Clone)]
pub struct Balance {
    pub denom: String,
    pub amount: String,
}

/// Query wallet balances from chain REST API
/// Returns balances and optional pagination key for next page
pub async fn query_balances(
    rest_endpoint: &str,
    address: &str,
    pagination_key: Option<&str>,
) -> anyhow::Result<(Vec<Balance>, Option<String>)> {
    let base_url = rest_endpoint.trim_end_matches('/');

    let url = match pagination_key {
        Some(key) => format!(
            "{}/cosmos/bank/v1beta1/balances/{}?pagination.limit=100&pagination.key={}",
            base_url, address, key
        ),
        None => format!(
            "{}/cosmos/bank/v1beta1/balances/{}?pagination.limit=100",
            base_url, address
        ),
    };

    log::info!("Querying balances at: {}", url);

    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(10))
        .build()?;

    let response = client.get(&url).send().await?;

    if !response.status().is_success() {
        return Err(anyhow::anyhow!(
            "Balance query failed with status: {}",
            response.status()
        ));
    }

    let json: Value = response.json().await?;
    log::debug!("Balance response: {}", json);

    let balances = json["balances"]
        .as_array()
        .ok_or_else(|| anyhow::anyhow!("Invalid response: missing balances array"))?
        .iter()
        .filter_map(|b| {
            let denom = b["denom"].as_str()?.to_string();
            let amount = b["amount"].as_str()?.to_string();
            Some(Balance { denom, amount })
        })
        .collect();

    // Check for pagination
    let next_key = json["pagination"]["next_key"]
        .as_str()
        .filter(|s| !s.is_empty())
        .map(|s| s.to_string());

    Ok((balances, next_key))
}

/// Query balances with fallback to multiple REST endpoints
pub async fn query_balances_with_fallback(
    endpoints: &[chain::Rest],
    address: &str,
    pagination_key: Option<&str>,
) -> anyhow::Result<(Vec<Balance>, Option<String>)> {
    let mut last_error = None;
    let max_attempts = 3.min(endpoints.len());

    for endpoint in endpoints.iter().take(max_attempts) {
        // Skip non-HTTPS endpoints
        if endpoint.address.starts_with("http://") || endpoint.address.is_empty() {
            continue;
        }

        log::info!("Trying REST endpoint for balances: {}", endpoint.address);

        match query_balances(&endpoint.address, address, pagination_key).await {
            Ok(result) => return Ok(result),
            Err(e) => {
                log::warn!("Failed with endpoint {}: {}", endpoint.address, e);
                last_error = Some(e);
            }
        }
    }

    Err(last_error.unwrap_or_else(|| anyhow::anyhow!("No valid REST endpoints available for balance query")))
}

/// Format amount with thousands separators
pub fn format_amount(amount: &str) -> String {
    // Parse the amount string as a number and format with commas
    if let Ok(num) = amount.parse::<u128>() {
        let s = num.to_string();
        let mut result = String::new();
        for (i, c) in s.chars().rev().enumerate() {
            if i > 0 && i % 3 == 0 {
                result.insert(0, ',');
            }
            result.insert(0, c);
        }
        result
    } else {
        amount.to_string()
    }
}

/// Truncate IBC hash for display (e.g., "ibc/27A6..." showing first 8 chars after ibc/)
pub fn truncate_ibc_hash(hash: &str) -> String {
    if hash.len() > 12 {
        format!("{}...", &hash[..12])
    } else {
        hash.to_string()
    }
}