use base64::{engine::general_purpose, Engine as _};
use cosmos_chain_registry::chain;
use cosmos_sdk_proto::cosmos::{
    bank::v1beta1::{query_client::QueryClient as BankQueryClient, QueryAllBalancesRequest},
    base::{
        query::v1beta1::PageRequest,
        tendermint::v1beta1::{
            service_client::ServiceClient as TendermintServiceClient, GetLatestBlockRequest,
            GetNodeInfoRequest,
        },
    },
};
use ibc_proto::ibc::{
    applications::transfer::v1::{
        query_client::QueryClient as TransferQueryClient, QueryDenomTraceRequest,
    },
    core::{
        channel::v1::{
            query_client::QueryClient as ChannelQueryClient, QueryChannelClientStateRequest,
            QueryChannelRequest,
        },
        connection::v1::{
            query_client::QueryClient as ConnectionQueryClient, QueryConnectionRequest,
        },
    },
    lightclients::tendermint::v1::ClientState as TendermintClientState,
};
use prost::Message as _;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::HashMap;
use std::time::Duration;
use tonic::transport::{Channel, Endpoint};

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
    ]
    .into_iter()
    .collect();

    // All supported chains on Polkachu (verified working)
    let supported: std::collections::HashSet<&str> = [
        "axelar",
        "babylon",
        "celestia",
        "cosmos",
        "dydx",
        "initia",
        "injective",
        "osmosis",
        "sei",
        "akash",
        "allora",
        "althea",
        "andromeda",
        "archway",
        "arkeo",
        "atomone",
        "aura",
        "band",
        "bitcanna",
        "bitsong",
        "bitway",
        "canto",
        "chain4energy",
        "cheqd",
        "chihuahua",
        "comdex",
        "crescent",
        "cronos",
        "decentr",
        "dhealth",
        "dymension",
        "elys",
        "evmos",
        "fetch",
        "functionx",
        "gitopia",
        "gravity",
        "haqq",
        "hippo",
        "humans",
        "intento",
        "jackal",
        "juno",
        "kava",
        "kichain",
        "kopi",
        "kujira",
        "kyve",
        "loyal",
        "lum",
        "lumera",
        "mantra",
        "meme",
        "milkyway",
        "neutron",
        "nibiru",
        "nillion",
        "noble",
        "nolus",
        "nym",
        "odin",
        "omniflix",
        "passage",
        "persistence",
        "picasso",
        "planq",
        "provenance",
        "quicksilver",
        "saga",
        "shentu",
        "shido",
        "sifchain",
        "sommelier",
        "source",
        "stargaze",
        "stride",
        "sunrise",
        "symphony",
        "tacchain",
        "teritori",
        "terra",
        "umee",
        "ununifi",
        "xpla",
    ]
    .into_iter()
    .collect();

    let chain_lower = chain_name.to_lowercase();

    // Check for special mapping first
    let slug = special_mappings
        .get(chain_lower.as_str())
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

pub async fn find_healthy_endpoint(endpoints: &[chain::Rpc], is_rpc: bool) -> Option<String> {
    for endpoint in endpoints {
        if check_endpoint_health(&endpoint.address, is_rpc).await {
            return Some(endpoint.address.clone());
        }
    }
    None
}

pub async fn find_healthy_rest_endpoint(endpoints: &[chain::Rest]) -> Option<String> {
    for endpoint in endpoints {
        if check_endpoint_health(&endpoint.address, false).await {
            return Some(endpoint.address.clone());
        }
    }
    None
}

fn normalize_grpc_uri(address: &str) -> Option<String> {
    let address = address.trim().trim_end_matches('/');
    if address.is_empty()
        || address.starts_with("http://")
        || (address.contains("://") && !address.starts_with("https://"))
    {
        return None;
    }

    if address.starts_with("https://") {
        Some(format!("{address}/"))
    } else {
        Some(format!("https://{address}/"))
    }
}

async fn connect_grpc(endpoint: &str) -> anyhow::Result<Channel> {
    Ok(Endpoint::from_shared(endpoint.to_string())?
        .connect_timeout(Duration::from_secs(5))
        .timeout(Duration::from_secs(10))
        .connect()
        .await?)
}

pub async fn check_grpc_endpoint_health(endpoint: &str) -> bool {
    let Ok(channel) = connect_grpc(endpoint).await else {
        return false;
    };

    let mut client = TendermintServiceClient::new(channel);
    client.get_node_info(GetNodeInfoRequest {}).await.is_ok()
}

pub async fn find_healthy_grpc_endpoint(endpoints: &[chain::Grpc]) -> Option<String> {
    for endpoint in prioritize_grpc_endpoints(endpoints) {
        if check_grpc_endpoint_health(&endpoint).await {
            return Some(endpoint);
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
            let base_denom = denom
                .get("base")
                .and_then(|v| v.as_str())
                .ok_or_else(|| anyhow::anyhow!("Missing base in alternate response"))?;

            // Reconstruct path from trace array
            let path = if let Some(trace) = denom.get("trace").and_then(|v| v.as_array()) {
                trace
                    .iter()
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

        return Err(anyhow::anyhow!(
            "Invalid response format from alternate endpoint"
        ));
    }

    let json: Value = response.json().await?;
    log::debug!("IBC denom trace response: {}", json);

    // Parse the standard response format
    if let Some(trace) = json["denom_trace"].as_object() {
        let path = trace.get("path").and_then(|v| v.as_str()).unwrap_or("");
        let base_denom = trace
            .get("base_denom")
            .and_then(|v| v.as_str())
            .ok_or_else(|| anyhow::anyhow!("Missing base_denom in response"))?;

        return Ok((path.to_string(), base_denom.to_string()));
    }

    // If denom_trace is not found in the expected format
    Err(anyhow::anyhow!(
        "Invalid response format: missing denom_trace"
    ))
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

pub async fn query_ibc_denom_grpc(
    grpc_endpoint: &str,
    ibc_hash: &str,
) -> anyhow::Result<IbcDenomTrace> {
    let mut client = TransferQueryClient::new(connect_grpc(grpc_endpoint).await?);
    let response = client
        .denom_trace(QueryDenomTraceRequest {
            hash: ibc_hash.to_string(),
        })
        .await?
        .into_inner();
    let trace = response
        .denom_trace
        .ok_or_else(|| anyhow::anyhow!("IBC denom trace not found"))?;

    Ok(IbcDenomTrace {
        path: trace.path,
        base_denom: trace.base_denom,
    })
}

pub async fn query_ibc_denom_grpc_first(
    grpc_endpoints: &[chain::Grpc],
    rest_endpoints: &[chain::Rest],
    ibc_hash: &str,
) -> anyhow::Result<IbcDenomTrace> {
    let mut last_error = None;

    for endpoint in prioritize_grpc_endpoints(grpc_endpoints).iter().take(3) {
        log::info!("Trying gRPC endpoint for IBC denom trace: {}", endpoint);
        match query_ibc_denom_grpc(endpoint, ibc_hash).await {
            Ok(result) => return Ok(result),
            Err(e) => {
                log::warn!("Failed gRPC denom trace with endpoint {}: {}", endpoint, e);
                last_error = Some(e);
            }
        }
    }

    match query_ibc_denom_with_fallback(rest_endpoints, ibc_hash).await {
        Ok((path, base_denom)) => Ok(IbcDenomTrace { path, base_denom }),
        Err(rest_error) => Err(last_error.unwrap_or(rest_error)),
    }
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
    let channel_url = format!(
        "{}/ibc/core/channel/v1/channels/{}/ports/{}",
        base_url, channel_id, port_id
    );
    log::info!("Fetching channel data from: {}", channel_url);

    let response = client.get(&channel_url).send().await?;
    if !response.status().is_success() {
        return Err(anyhow::anyhow!(
            "Channel {} not found on port {}",
            channel_id,
            port_id
        ));
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
    let connection_url = format!(
        "{}/ibc/core/connection/v1/connections/{}",
        base_url, connection_id
    );
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
    let client_state_url = format!(
        "{}/ibc/core/channel/v1/channels/{}/ports/{}/client_state",
        base_url, channel_id, port_id
    );
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

        log::info!(
            "Trying REST endpoint for channel info: {}",
            endpoint.address
        );

        match query_ibc_channel_info(&endpoint.address, channel_id, port_id).await {
            Ok(result) => return Ok(result),
            Err(e) => {
                log::warn!("Failed with endpoint {}: {}", endpoint.address, e);
                last_error = Some(e);
            }
        }
    }

    Err(last_error
        .unwrap_or_else(|| anyhow::anyhow!("No valid REST endpoints available for channel query")))
}

fn decode_tendermint_client_chain_id(
    client_state: &tendermint_proto::google::protobuf::Any,
) -> anyhow::Result<String> {
    if !client_state
        .type_url
        .ends_with("ibc.lightclients.tendermint.v1.ClientState")
    {
        return Err(anyhow::anyhow!(
            "unsupported client state type {}",
            client_state.type_url
        ));
    }

    let client_state = TendermintClientState::decode(client_state.value.as_slice())?;
    if client_state.chain_id.is_empty() {
        return Err(anyhow::anyhow!("decoded client state missing chain ID"));
    }
    Ok(client_state.chain_id)
}

pub async fn query_ibc_channel_info_grpc(
    grpc_endpoint: &str,
    channel_id: &str,
    port_id: &str,
) -> anyhow::Result<IbcChannelInfo> {
    let transport = connect_grpc(grpc_endpoint).await?;

    let mut node_client = TendermintServiceClient::new(transport.clone());
    let node_info = node_client
        .get_node_info(GetNodeInfoRequest {})
        .await?
        .into_inner();
    let chain_id = node_info
        .default_node_info
        .ok_or_else(|| anyhow::anyhow!("Chain node info not found"))?
        .network;

    let mut channel_client = ChannelQueryClient::new(transport.clone());
    let channel_response = channel_client
        .channel(QueryChannelRequest {
            port_id: port_id.to_string(),
            channel_id: channel_id.to_string(),
        })
        .await?
        .into_inner();
    let channel = channel_response
        .channel
        .ok_or_else(|| anyhow::anyhow!("Channel {} not found on port {}", channel_id, port_id))?;

    let counterparty_channel_id = channel
        .counterparty
        .as_ref()
        .ok_or_else(|| anyhow::anyhow!("Counterparty channel not found"))?
        .channel_id
        .clone();

    let connection_id = channel
        .connection_hops
        .first()
        .ok_or_else(|| anyhow::anyhow!("Connection ID not found"))?
        .clone();

    let mut connection_client = ConnectionQueryClient::new(transport);
    let connection_response = connection_client
        .connection(QueryConnectionRequest {
            connection_id: connection_id.clone(),
        })
        .await?
        .into_inner();
    let connection = connection_response
        .connection
        .ok_or_else(|| anyhow::anyhow!("Connection {} not found", connection_id))?;

    let client_id = connection.client_id.clone();
    let counterparty = connection
        .counterparty
        .ok_or_else(|| anyhow::anyhow!("Counterparty connection not found"))?;

    let client_state_response = channel_client
        .channel_client_state(QueryChannelClientStateRequest {
            port_id: port_id.to_string(),
            channel_id: channel_id.to_string(),
        })
        .await?
        .into_inner();
    let identified_client_state = client_state_response
        .identified_client_state
        .ok_or_else(|| anyhow::anyhow!("Counterparty client state not found"))?;
    let client_state = identified_client_state
        .client_state
        .ok_or_else(|| anyhow::anyhow!("Counterparty client state payload not found"))?;
    let counterparty_chain_id = decode_tendermint_client_chain_id(&client_state)?;

    Ok(IbcChannelInfo {
        chain_id,
        counterparty_chain_id,
        client_id,
        connection_id,
        counterparty_client_id: counterparty.client_id,
        counterparty_connection_id: counterparty.connection_id,
        channel_id: channel_id.to_string(),
        counterparty_channel_id,
    })
}

pub async fn query_ibc_channel_info_grpc_first(
    grpc_endpoints: &[chain::Grpc],
    rest_endpoints: &[chain::Rest],
    channel_id: &str,
    port_id: &str,
) -> anyhow::Result<IbcChannelInfo> {
    let mut last_error = None;

    for endpoint in prioritize_grpc_endpoints(grpc_endpoints).iter().take(3) {
        log::info!("Trying gRPC endpoint for IBC channel info: {}", endpoint);
        match query_ibc_channel_info_grpc(endpoint, channel_id, port_id).await {
            Ok(result) => return Ok(result),
            Err(e) => {
                log::warn!("Failed gRPC channel info with endpoint {}: {}", endpoint, e);
                last_error = Some(e);
            }
        }
    }

    match query_ibc_channel_info_with_fallback(rest_endpoints, channel_id, port_id).await {
        Ok(result) => Ok(result),
        Err(rest_error) => Err(last_error.unwrap_or(rest_error)),
    }
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
        last_block_height: resp["last_block_height"]
            .as_str()
            .unwrap_or("Unknown")
            .to_string(),
        last_block_app_hash: resp["last_block_app_hash"]
            .as_str()
            .unwrap_or("Unknown")
            .to_string(),
    })
}

fn bytes_to_upper_hex(bytes: &[u8]) -> String {
    if bytes.is_empty() {
        return "Unknown".to_string();
    }

    bytes.iter().map(|byte| format!("{byte:02X}")).collect()
}

pub async fn query_abci_info_grpc(grpc_endpoint: &str) -> Option<AbciInfo> {
    let channel = connect_grpc(grpc_endpoint).await.ok()?;
    let mut client = TendermintServiceClient::new(channel);

    let node_info = client
        .get_node_info(GetNodeInfoRequest {})
        .await
        .ok()?
        .into_inner();
    let version = node_info
        .application_version
        .map(|version| {
            if !version.version.is_empty() {
                version.version
            } else if !version.cosmos_sdk_version.is_empty() {
                version.cosmos_sdk_version
            } else {
                "Unknown".to_string()
            }
        })
        .unwrap_or_else(|| "Unknown".to_string());

    let latest_block = client
        .get_latest_block(GetLatestBlockRequest {})
        .await
        .ok()?
        .into_inner();

    if let Some(sdk_block) = latest_block.sdk_block {
        let header = sdk_block.header?;
        return Some(AbciInfo {
            version,
            last_block_height: header.height.to_string(),
            last_block_app_hash: bytes_to_upper_hex(&header.app_hash),
        });
    }

    let header = latest_block.block?.header?;
    Some(AbciInfo {
        version,
        last_block_height: header.height.to_string(),
        last_block_app_hash: bytes_to_upper_hex(&header.app_hash),
    })
}

/// Balance entry from bank query
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Balance {
    pub denom: String,
    pub amount: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct IbcDenomTrace {
    pub path: String,
    pub base_denom: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct WalletBalance {
    pub balance: Balance,
    pub ibc_trace: Option<IbcDenomTrace>,
    pub asset_label: Option<String>,
}

#[derive(Debug, Clone)]
pub struct OsmosisGaugeIncentive {
    pub gauge_id: String,
    pub duration: String,
    pub incentive_percentage: String,
    pub coins: Vec<Balance>,
    pub distributed_coins: Vec<Balance>,
}

#[derive(Debug, Clone)]
pub struct OsmosisClIncentive {
    pub incentive_id: String,
    pub denom: String,
    pub remaining_amount: String,
    pub emission_rate: String,
    pub start_time: String,
}

#[derive(Debug, Clone)]
pub struct OsmosisPoolIncentives {
    pub gauges: Vec<OsmosisGaugeIncentive>,
    pub cl_records: Vec<OsmosisClIncentive>,
}

#[derive(Debug, Clone)]
pub struct OsmosisTokenPrice {
    pub name: String,
    pub symbol: String,
    pub denom: String,
    pub quote_symbol: String,
    pub quote_denom: String,
    pub price: String,
}

#[derive(Debug, Clone)]
struct OsmosisTokenMetadata {
    name: String,
    symbol: String,
    denom: String,
    preview: bool,
}

async fn get_json(client: &reqwest::Client, url: &str) -> anyhow::Result<Value> {
    let response = client.get(url).send().await?;
    if !response.status().is_success() {
        return Err(anyhow::anyhow!(
            "request failed with status {} for {}",
            response.status(),
            url
        ));
    }

    Ok(response.json().await?)
}

fn parse_coin_array(value: &Value) -> Vec<Balance> {
    value
        .as_array()
        .map(|coins| {
            coins
                .iter()
                .filter_map(|coin| {
                    Some(Balance {
                        denom: coin["denom"].as_str()?.to_string(),
                        amount: coin["amount"].as_str()?.to_string(),
                    })
                })
                .collect()
        })
        .unwrap_or_default()
}

fn encode_query_component(value: &str) -> String {
    let mut encoded = String::new();
    for byte in value.bytes() {
        if byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_' | b'.' | b'~') {
            encoded.push(byte as char);
        } else {
            encoded.push_str(&format!("%{byte:02X}"));
        }
    }
    encoded
}

fn resolve_token_metadata(metadata: &Value, input: &str) -> Option<OsmosisTokenMetadata> {
    let needle = input.trim();
    let mut preview_match = None;

    for token in metadata.as_object()?.values() {
        let denom = token["coinMinimalDenom"].as_str().unwrap_or_default();
        let symbol = token["symbol"].as_str().unwrap_or_default();

        if denom.eq_ignore_ascii_case(needle) || symbol.eq_ignore_ascii_case(needle) {
            let candidate = OsmosisTokenMetadata {
                name: token["name"].as_str().unwrap_or(symbol).to_string(),
                symbol: symbol.to_string(),
                denom: denom.to_string(),
                preview: token["preview"].as_bool().unwrap_or(false),
            };

            if !candidate.preview {
                return Some(candidate);
            }
            preview_match = Some(candidate);
        }
    }

    preview_match
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

pub async fn query_balances_grpc(
    grpc_endpoint: &str,
    address: &str,
    pagination_key: Option<&str>,
) -> anyhow::Result<(Vec<Balance>, Option<String>)> {
    let key = match pagination_key {
        Some(key) => general_purpose::STANDARD.decode(key).unwrap_or_default(),
        None => Vec::new(),
    };

    let mut client = BankQueryClient::new(connect_grpc(grpc_endpoint).await?);
    let response = client
        .all_balances(QueryAllBalancesRequest {
            address: address.to_string(),
            pagination: Some(PageRequest {
                key,
                offset: 0,
                limit: 100,
                count_total: false,
                reverse: false,
            }),
            resolve_denom: false,
        })
        .await?
        .into_inner();

    let balances = response
        .balances
        .into_iter()
        .map(|coin| Balance {
            denom: coin.denom,
            amount: coin.amount,
        })
        .collect();

    let next_key = response
        .pagination
        .and_then(|pagination| (!pagination.next_key.is_empty()).then_some(pagination.next_key))
        .map(|next_key| general_purpose::STANDARD.encode(next_key));

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

    Err(last_error
        .unwrap_or_else(|| anyhow::anyhow!("No valid REST endpoints available for balance query")))
}

pub async fn query_balances_grpc_first(
    grpc_endpoints: &[chain::Grpc],
    rest_endpoints: &[chain::Rest],
    address: &str,
    pagination_key: Option<&str>,
) -> anyhow::Result<(Vec<Balance>, Option<String>)> {
    let mut last_error = None;

    for endpoint in prioritize_grpc_endpoints(grpc_endpoints).iter().take(3) {
        log::info!("Trying gRPC endpoint for balances: {}", endpoint);
        match query_balances_grpc(endpoint, address, pagination_key).await {
            Ok(result) => return Ok(result),
            Err(e) => {
                log::warn!(
                    "Failed gRPC balance query with endpoint {}: {}",
                    endpoint,
                    e
                );
                last_error = Some(e);
            }
        }
    }

    match query_balances_with_fallback(rest_endpoints, address, pagination_key).await {
        Ok(result) => Ok(result),
        Err(rest_error) => Err(last_error.unwrap_or(rest_error)),
    }
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

pub fn prioritize_grpc_endpoints(endpoints: &[chain::Grpc]) -> Vec<String> {
    let mut polkachu = Vec::new();
    let mut others = Vec::new();

    for endpoint in endpoints {
        let Some(uri) = normalize_grpc_uri(&endpoint.address) else {
            continue;
        };

        let is_polkachu = endpoint
            .provider
            .as_deref()
            .unwrap_or_default()
            .to_lowercase()
            .contains("polkachu")
            || endpoint.address.to_lowercase().contains("polkachu.com");

        if is_polkachu {
            polkachu.push(uri);
        } else {
            others.push(uri);
        }
    }

    polkachu.extend(others);
    polkachu
}

fn escape_markdown_code(text: &str) -> String {
    text.replace('\\', "\\\\").replace('`', "\\`")
}

fn display_asset_label(
    denom: &str,
    trace: Option<&IbcDenomTrace>,
    asset_label: Option<&str>,
) -> String {
    if let Some(asset_label) = asset_label.filter(|label| !label.is_empty()) {
        return asset_label.to_string();
    }

    let display = trace.map(|t| t.base_denom.as_str()).unwrap_or(denom);
    display
        .rsplit('/')
        .next()
        .filter(|segment| !segment.is_empty())
        .unwrap_or(display)
        .to_string()
}

pub fn format_wallet_balances(
    address: &str,
    chain: &str,
    balances: &[WalletBalance],
    more_available: bool,
) -> String {
    let display_address = if address.len() > 20 {
        format!("{}...", &address[..20])
    } else {
        address.to_string()
    };

    let mut message = format!(
        "💰 *Balances for* `{}` on *{}*",
        escape_markdown_code(&display_address),
        escape_markdown(chain)
    );

    for wallet_balance in balances {
        let label = display_asset_label(
            &wallet_balance.balance.denom,
            wallet_balance.ibc_trace.as_ref(),
            wallet_balance.asset_label.as_deref(),
        );
        message.push_str(&format!(
            "\n\n*{}*\nAmount: `{}`",
            escape_markdown(&label),
            escape_markdown_code(&format_amount(&wallet_balance.balance.amount))
        ));

        if let Some(trace) = &wallet_balance.ibc_trace {
            message.push_str(&format!(
                "\nIBC Denom: `{}`\nIBC Path: `{}`\nBase Denom: `{}`",
                escape_markdown_code(&wallet_balance.balance.denom),
                escape_markdown_code(&trace.path),
                escape_markdown_code(&trace.base_denom)
            ));
        } else {
            message.push_str(&format!(
                "\nDenom: `{}`",
                escape_markdown_code(&wallet_balance.balance.denom)
            ));
        }
    }

    if more_available {
        message.push_str("\n\n_Showing first 100 assets; more balances are available\\._");
    }

    message
}

pub async fn query_osmosis_pool_info(
    endpoints: &[chain::Rest],
    pool_id: &str,
) -> anyhow::Result<Value> {
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(10))
        .build()?;
    let paths = [
        format!("/osmosis/poolmanager/v1beta1/pools/{pool_id}"),
        format!("/osmosis/gamm/v1beta1/pools/{pool_id}"),
    ];
    let max_attempts = 3.min(endpoints.len());
    let mut last_error = None;

    for endpoint in endpoints.iter().take(max_attempts) {
        if endpoint.address.starts_with("http://") || endpoint.address.is_empty() {
            continue;
        }

        for path in &paths {
            let url = format!("{}{}", endpoint.address.trim_end_matches('/'), path);
            match get_json(&client, &url).await {
                Ok(json) => {
                    if let Some(pool) = json.get("pool") {
                        return Ok(pool.clone());
                    }
                    last_error = Some(anyhow::anyhow!("pool response missing pool object"));
                }
                Err(e) => last_error = Some(e),
            }
        }
    }

    Err(last_error.unwrap_or_else(|| anyhow::anyhow!("No Osmosis REST pool endpoint available")))
}

pub async fn query_osmosis_pool_incentives(
    endpoints: &[chain::Rest],
    pool_id: &str,
) -> anyhow::Result<OsmosisPoolIncentives> {
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(10))
        .build()?;
    let max_attempts = 3.min(endpoints.len());
    let mut last_error = None;

    for endpoint in endpoints.iter().take(max_attempts) {
        if endpoint.address.starts_with("http://") || endpoint.address.is_empty() {
            continue;
        }

        let base = endpoint.address.trim_end_matches('/');
        let gauge_url = format!("{base}/osmosis/pool-incentives/v1beta1/gauge-ids/{pool_id}");
        let gauge_ids = match get_json(&client, &gauge_url).await {
            Ok(json) => json,
            Err(e) => {
                last_error = Some(e);
                continue;
            }
        };

        let mut gauges = Vec::new();
        for gauge in gauge_ids["gauge_ids_with_duration"]
            .as_array()
            .into_iter()
            .flatten()
            .take(8)
        {
            let Some(gauge_id) = gauge["gauge_id"].as_str() else {
                continue;
            };
            let detail_url = format!("{base}/osmosis/incentives/v1beta1/gauge_by_id/{gauge_id}");
            let detail = get_json(&client, &detail_url).await.unwrap_or_default();
            let gauge_detail = &detail["gauge"];

            gauges.push(OsmosisGaugeIncentive {
                gauge_id: gauge_id.to_string(),
                duration: gauge["duration"].as_str().unwrap_or("unknown").to_string(),
                incentive_percentage: gauge["gauge_incentive_percentage"]
                    .as_str()
                    .unwrap_or("unknown")
                    .to_string(),
                coins: parse_coin_array(&gauge_detail["coins"]),
                distributed_coins: parse_coin_array(&gauge_detail["distributed_coins"]),
            });
        }

        let cl_url = format!(
            "{base}/osmosis/concentratedliquidity/v1beta1/incentive_records?pool_id={pool_id}"
        );
        let cl_json = get_json(&client, &cl_url).await.unwrap_or_default();
        let cl_records = cl_json["incentive_records"]
            .as_array()
            .map(|records| {
                records
                    .iter()
                    .take(8)
                    .filter_map(|record| {
                        let body = &record["incentive_record_body"];
                        let coin = &body["remaining_coin"];
                        Some(OsmosisClIncentive {
                            incentive_id: record["incentive_id"].as_str()?.to_string(),
                            denom: coin["denom"].as_str()?.to_string(),
                            remaining_amount: coin["amount"].as_str()?.to_string(),
                            emission_rate: body["emission_rate"].as_str()?.to_string(),
                            start_time: body["start_time"]
                                .as_str()
                                .unwrap_or("unknown")
                                .to_string(),
                        })
                    })
                    .collect()
            })
            .unwrap_or_default();

        return Ok(OsmosisPoolIncentives { gauges, cl_records });
    }

    Err(last_error.unwrap_or_else(|| anyhow::anyhow!("No Osmosis incentive endpoint available")))
}

pub async fn query_osmosis_token_price(token: &str) -> anyhow::Result<OsmosisTokenPrice> {
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(10))
        .build()?;
    let metadata = get_json(&client, "https://sqs.osmosis.zone/tokens/metadata").await?;
    let token_metadata = resolve_token_metadata(&metadata, token).unwrap_or_else(|| {
        let trimmed = token.trim().to_string();
        OsmosisTokenMetadata {
            name: trimmed.clone(),
            symbol: trimmed.clone(),
            denom: trimmed,
            preview: false,
        }
    });

    let price_url = format!(
        "https://sqs.osmosis.zone/tokens/prices?base={}",
        encode_query_component(&token_metadata.denom)
    );
    let price_json = get_json(&client, &price_url).await?;
    let quotes = price_json
        .get(&token_metadata.denom)
        .and_then(|v| v.as_object())
        .ok_or_else(|| anyhow::anyhow!("No price quote found for {}", token_metadata.symbol))?;
    let (quote_denom, price) = quotes
        .iter()
        .next()
        .ok_or_else(|| anyhow::anyhow!("No price quote found for {}", token_metadata.symbol))?;
    let quote_metadata = resolve_token_metadata(&metadata, quote_denom);

    Ok(OsmosisTokenPrice {
        name: token_metadata.name,
        symbol: token_metadata.symbol,
        denom: token_metadata.denom,
        quote_symbol: quote_metadata
            .as_ref()
            .map(|m| m.symbol.clone())
            .unwrap_or_else(|| truncate_ibc_hash(quote_denom)),
        quote_denom: quote_denom.to_string(),
        price: price.as_str().unwrap_or("unknown").to_string(),
    })
}

fn short_pool_type(pool_type: &str) -> &str {
    pool_type.rsplit('.').next().unwrap_or(pool_type)
}

pub fn format_osmosis_pool_info(pool_id: &str, pool: &Value) -> String {
    let pool_type = pool["@type"].as_str().unwrap_or("unknown");
    let mut message = format!(
        "Osmosis Pool {pool_id}\nType: {}\n",
        short_pool_type(pool_type)
    );

    if let Some(address) = pool["address"].as_str() {
        message.push_str(&format!("Address: {address}\n"));
    }
    if let Some(swap_fee) = pool["pool_params"]["swap_fee"].as_str() {
        message.push_str(&format!("Swap Fee: {swap_fee}\n"));
    }
    if let Some(total_shares) = pool["total_shares"]["amount"].as_str() {
        message.push_str(&format!("Total Shares: {}\n", format_amount(total_shares)));
    }

    if let Some(assets) = pool["pool_assets"].as_array() {
        message.push_str("\nAssets:\n");
        for asset in assets.iter().take(8) {
            let token = &asset["token"];
            let denom = token["denom"].as_str().unwrap_or("unknown");
            let amount = token["amount"].as_str().unwrap_or("0");
            let weight = asset["weight"].as_str().unwrap_or("unknown");
            message.push_str(&format!(
                "- {}: {} (weight {})\n",
                truncate_ibc_hash(denom),
                format_amount(amount),
                weight
            ));
        }
    } else if let Some(liquidity) = pool["current_tick_liquidity"].as_str() {
        message.push_str(&format!("Current Tick Liquidity: {liquidity}\n"));
    }

    message
}

fn format_coin_lines(coins: &[Balance]) -> String {
    if coins.is_empty() {
        return "none".to_string();
    }

    coins
        .iter()
        .map(|coin| {
            format!(
                "{} {}",
                format_amount(&coin.amount),
                truncate_ibc_hash(&coin.denom)
            )
        })
        .collect::<Vec<_>>()
        .join(", ")
}

pub fn format_osmosis_pool_incentives(pool_id: &str, incentives: &OsmosisPoolIncentives) -> String {
    if incentives.gauges.is_empty() && incentives.cl_records.is_empty() {
        return format!("No active incentives found for Osmosis pool {pool_id}.");
    }

    let mut message = format!("Osmosis Pool {pool_id} Incentives\n");

    if !incentives.gauges.is_empty() {
        message.push_str("\nGauge Incentives:\n");
        for gauge in &incentives.gauges {
            message.push_str(&format!(
                "- Gauge {} ({}): {}\n  remaining: {}\n  distributed: {}\n",
                gauge.gauge_id,
                gauge.duration,
                gauge.incentive_percentage,
                format_coin_lines(&gauge.coins),
                format_coin_lines(&gauge.distributed_coins)
            ));
        }
    }

    if !incentives.cl_records.is_empty() {
        message.push_str("\nConcentrated Liquidity Records:\n");
        for record in &incentives.cl_records {
            message.push_str(&format!(
                "- Incentive {}: {} {} remaining, emission {}, starts {}\n",
                record.incentive_id,
                format_amount(&record.remaining_amount),
                truncate_ibc_hash(&record.denom),
                record.emission_rate,
                record.start_time
            ));
        }
    }

    message
}

pub fn format_osmosis_token_price(price: &OsmosisTokenPrice) -> String {
    format!(
        "Osmosis Price\nToken: {} ({})\nDenom: {}\nPrice: {} {}\nQuote Denom: {}",
        price.name,
        price.symbol,
        truncate_ibc_hash(&price.denom),
        price.price,
        price.quote_symbol,
        truncate_ibc_hash(&price.quote_denom)
    )
}
