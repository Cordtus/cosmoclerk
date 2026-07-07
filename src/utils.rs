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
use osmosis_std::{
    shim::{Any as OsmosisAny, Duration as OsmosisDuration, Timestamp as OsmosisTimestamp},
    types::osmosis::{
        concentratedliquidity::v1beta1::{
            IncentiveRecordsRequest, IncentiveRecordsResponse, Pool as ConcentratedPool,
        },
        cosmwasmpool::v1beta1::CosmWasmPool,
        gamm::{
            poolmodels::stableswap::v1beta1::Pool as StableswapPool, v1beta1::Pool as GammPool,
        },
        incentives::{GaugeByIdRequest, GaugeByIdResponse},
        poolincentives::v1beta1::{QueryGaugeIdsRequest, QueryGaugeIdsResponse},
        poolmanager::v1beta1::{
            PoolRequest as PoolManagerPoolRequest, PoolResponse as PoolManagerPoolResponse,
        },
        txfees::v1beta1::{QueryDenomSpotPriceRequest, QueryDenomSpotPriceResponse},
    },
};
use prost::Message as _;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::HashMap;
use std::time::Duration;
use tonic::{
    codec::ProstCodec,
    codegen::http::uri::PathAndQuery,
    transport::{Channel, Endpoint},
};

pub const PAGE_SIZE: usize = 18;

pub trait EndpointAddress {
    fn endpoint_address(&self) -> &str;
}

impl EndpointAddress for chain::Rpc {
    fn endpoint_address(&self) -> &str {
        &self.address
    }
}

impl EndpointAddress for chain::Rest {
    fn endpoint_address(&self) -> &str {
        &self.address
    }
}

pub fn first_endpoint_address<T: EndpointAddress>(endpoints: &[T]) -> String {
    endpoints
        .first()
        .map(|endpoint| endpoint.endpoint_address().to_string())
        .unwrap_or_else(|| "Unknown".to_string())
}

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

fn normalize_grpc_uri(address: &str) -> Option<String> {
    let address = address.trim().trim_end_matches('/');
    if address.is_empty() {
        return None;
    }

    if address.starts_with("http://") || address.starts_with("https://") {
        Some(format!("{address}/"))
    } else if address.contains("://") {
        None
    } else {
        let lower = address.to_lowercase();
        let explicit_port = address
            .rsplit_once(':')
            .map(|(_, port)| port)
            .filter(|port| port.chars().all(|c| c.is_ascii_digit()));
        let uses_tls = !lower.contains("polkachu.com")
            && explicit_port.map(|port| port == "443").unwrap_or(true);
        let scheme = if uses_tls { "https" } else { "http" };
        Some(format!("{scheme}://{address}/"))
    }
}

async fn connect_grpc(endpoint: &str) -> anyhow::Result<Channel> {
    Ok(Endpoint::from_shared(endpoint.to_string())?
        .connect_timeout(Duration::from_secs(5))
        .timeout(Duration::from_secs(10))
        .connect()
        .await?)
}

async fn grpc_unary<Req, Resp>(
    channel: Channel,
    path: &'static str,
    request: Req,
) -> anyhow::Result<Resp>
where
    Req: prost::Message + Default + Send + 'static,
    Resp: prost::Message + Default + Send + 'static,
{
    let mut client = tonic::client::Grpc::new(channel);
    client
        .ready()
        .await
        .map_err(|e| anyhow::anyhow!("gRPC service not ready: {e}"))?;

    Ok(client
        .unary(
            tonic::Request::new(request),
            PathAndQuery::from_static(path),
            ProstCodec::default(),
        )
        .await?
        .into_inner())
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

    Err(last_error.unwrap_or_else(|| anyhow::anyhow!("No valid gRPC endpoints available")))
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

    Err(last_error.unwrap_or_else(|| anyhow::anyhow!("No valid gRPC endpoints available")))
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

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct OsmosisPoolAsset {
    pub denom: String,
    pub amount: String,
    pub weight: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct OsmosisPoolInfo {
    pub pool_type: String,
    pub address: Option<String>,
    pub swap_fee: Option<String>,
    pub total_shares: Option<String>,
    pub assets: Vec<OsmosisPoolAsset>,
    pub current_tick_liquidity: Option<String>,
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

pub async fn query_balances_grpc_first(
    grpc_endpoints: &[chain::Grpc],
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

    Err(last_error.unwrap_or_else(|| anyhow::anyhow!("No valid gRPC endpoints available")))
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

    for (index, wallet_balance) in balances.iter().enumerate() {
        if index > 0 {
            message.push_str("\n\n\\-\\-\\-");
        }

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

fn parse_pool_id_value(pool_id: &str) -> anyhow::Result<u64> {
    pool_id
        .parse::<u64>()
        .map_err(|_| anyhow::anyhow!("Pool ID must be numeric"))
}

fn non_empty(value: String) -> Option<String> {
    (!value.is_empty()).then_some(value)
}

fn balance_from_osmosis_coin(coin: osmosis_std::types::cosmos::base::v1beta1::Coin) -> Balance {
    Balance {
        denom: coin.denom,
        amount: coin.amount,
    }
}

fn balance_from_osmosis_dec_coin(
    coin: osmosis_std::types::cosmos::base::v1beta1::DecCoin,
) -> Balance {
    Balance {
        denom: coin.denom,
        amount: coin.amount,
    }
}

fn duration_to_string(duration: Option<&OsmosisDuration>) -> String {
    match duration {
        Some(duration) if duration.nanos == 0 => format!("{}s", duration.seconds),
        Some(duration) => format!("{}.{:09}s", duration.seconds, duration.nanos.abs()),
        None => "unknown".to_string(),
    }
}

fn timestamp_to_string(timestamp: Option<&OsmosisTimestamp>) -> String {
    timestamp
        .and_then(|timestamp| {
            chrono::DateTime::<chrono::Utc>::from_timestamp(
                timestamp.seconds,
                timestamp.nanos as u32,
            )
        })
        .map(|timestamp| timestamp.to_rfc3339())
        .unwrap_or_else(|| "unknown".to_string())
}

fn pool_info_from_gamm_pool(pool: GammPool) -> OsmosisPoolInfo {
    OsmosisPoolInfo {
        pool_type: "Balancer".to_string(),
        address: non_empty(pool.address),
        swap_fee: pool
            .pool_params
            .and_then(|params| non_empty(params.swap_fee)),
        total_shares: pool
            .total_shares
            .and_then(|shares| non_empty(shares.amount)),
        assets: pool
            .pool_assets
            .into_iter()
            .filter_map(|asset| {
                let token = asset.token?;
                Some(OsmosisPoolAsset {
                    denom: token.denom,
                    amount: token.amount,
                    weight: non_empty(asset.weight),
                })
            })
            .collect(),
        current_tick_liquidity: None,
    }
}

fn pool_info_from_stableswap_pool(pool: StableswapPool) -> OsmosisPoolInfo {
    OsmosisPoolInfo {
        pool_type: "Stableswap".to_string(),
        address: non_empty(pool.address),
        swap_fee: pool
            .pool_params
            .and_then(|params| non_empty(params.swap_fee)),
        total_shares: pool
            .total_shares
            .and_then(|shares| non_empty(shares.amount)),
        assets: pool
            .pool_liquidity
            .into_iter()
            .map(|coin| OsmosisPoolAsset {
                denom: coin.denom,
                amount: coin.amount,
                weight: None,
            })
            .collect(),
        current_tick_liquidity: None,
    }
}

fn pool_info_from_concentrated_pool(pool: ConcentratedPool) -> OsmosisPoolInfo {
    OsmosisPoolInfo {
        pool_type: "Concentrated".to_string(),
        address: non_empty(pool.address),
        swap_fee: non_empty(pool.spread_factor),
        total_shares: None,
        assets: [pool.token0, pool.token1]
            .into_iter()
            .filter(|denom| !denom.is_empty())
            .map(|denom| OsmosisPoolAsset {
                denom,
                amount: String::new(),
                weight: None,
            })
            .collect(),
        current_tick_liquidity: non_empty(pool.current_tick_liquidity),
    }
}

fn pool_info_from_cosmwasm_pool(pool: CosmWasmPool) -> OsmosisPoolInfo {
    OsmosisPoolInfo {
        pool_type: "CosmWasm".to_string(),
        address: non_empty(pool.contract_address),
        swap_fee: None,
        total_shares: None,
        assets: Vec::new(),
        current_tick_liquidity: None,
    }
}

fn decode_osmosis_pool(pool: OsmosisAny) -> anyhow::Result<OsmosisPoolInfo> {
    match pool.type_url.as_str() {
        "/osmosis.gamm.v1beta1.Pool" => Ok(pool_info_from_gamm_pool(GammPool::decode(
            pool.value.as_slice(),
        )?)),
        "/osmosis.gamm.poolmodels.stableswap.v1beta1.Pool" => Ok(pool_info_from_stableswap_pool(
            StableswapPool::decode(pool.value.as_slice())?,
        )),
        "/osmosis.concentratedliquidity.v1beta1.Pool" => Ok(pool_info_from_concentrated_pool(
            ConcentratedPool::decode(pool.value.as_slice())?,
        )),
        "/osmosis.cosmwasmpool.v1beta1.CosmWasmPool" => Ok(pool_info_from_cosmwasm_pool(
            CosmWasmPool::decode(pool.value.as_slice())?,
        )),
        other => Err(anyhow::anyhow!("Unsupported Osmosis pool type {other}")),
    }
}

async fn query_osmosis_pool_info_grpc(
    grpc_endpoint: &str,
    pool_id: u64,
) -> anyhow::Result<OsmosisPoolInfo> {
    let response: PoolManagerPoolResponse = grpc_unary(
        connect_grpc(grpc_endpoint).await?,
        "/osmosis.poolmanager.v1beta1.Query/Pool",
        PoolManagerPoolRequest { pool_id },
    )
    .await?;

    decode_osmosis_pool(
        response.pool.ok_or_else(|| {
            anyhow::anyhow!("Osmosis pool {pool_id} response missing pool object")
        })?,
    )
}

pub async fn query_osmosis_pool_info(
    grpc_endpoints: &[chain::Grpc],
    pool_id: &str,
) -> anyhow::Result<OsmosisPoolInfo> {
    let pool_id = parse_pool_id_value(pool_id)?;
    let mut last_error = None;

    for endpoint in prioritize_grpc_endpoints(grpc_endpoints).iter().take(3) {
        match query_osmosis_pool_info_grpc(endpoint, pool_id).await {
            Ok(result) => return Ok(result),
            Err(e) => {
                log::warn!("Failed Osmosis pool gRPC query with endpoint {endpoint}: {e}");
                last_error = Some(e);
            }
        }
    }

    Err(last_error.unwrap_or_else(|| anyhow::anyhow!("No valid Osmosis gRPC endpoint available")))
}

async fn query_osmosis_pool_incentives_grpc(
    grpc_endpoint: &str,
    pool_id: u64,
) -> anyhow::Result<OsmosisPoolIncentives> {
    let channel = connect_grpc(grpc_endpoint).await?;
    let gauge_ids: QueryGaugeIdsResponse = grpc_unary(
        channel.clone(),
        "/osmosis.poolincentives.v1beta1.Query/GaugeIds",
        QueryGaugeIdsRequest { pool_id },
    )
    .await?;

    let mut gauges = Vec::new();
    for gauge in gauge_ids.gauge_ids_with_duration.into_iter().take(8) {
        let gauge_detail = grpc_unary::<GaugeByIdRequest, GaugeByIdResponse>(
            channel.clone(),
            "/osmosis.incentives.Query/GaugeByID",
            GaugeByIdRequest { id: gauge.gauge_id },
        )
        .await
        .ok()
        .and_then(|response| response.gauge);

        let (coins, distributed_coins) = gauge_detail
            .map(|gauge| {
                (
                    gauge
                        .coins
                        .into_iter()
                        .map(balance_from_osmosis_coin)
                        .collect(),
                    gauge
                        .distributed_coins
                        .into_iter()
                        .map(balance_from_osmosis_coin)
                        .collect(),
                )
            })
            .unwrap_or_else(|| (Vec::new(), Vec::new()));

        gauges.push(OsmosisGaugeIncentive {
            gauge_id: gauge.gauge_id.to_string(),
            duration: duration_to_string(gauge.duration.as_ref()),
            incentive_percentage: non_empty(gauge.gauge_incentive_percentage)
                .unwrap_or_else(|| "unknown".to_string()),
            coins,
            distributed_coins,
        });
    }

    let cl_records = grpc_unary::<IncentiveRecordsRequest, IncentiveRecordsResponse>(
        channel,
        "/osmosis.concentratedliquidity.v1beta1.Query/IncentiveRecords",
        IncentiveRecordsRequest {
            pool_id,
            pagination: None,
        },
    )
    .await
    .map(|response| {
        response
            .incentive_records
            .into_iter()
            .take(8)
            .filter_map(|record| {
                let body = record.incentive_record_body?;
                let coin = body.remaining_coin.map(balance_from_osmosis_dec_coin)?;
                Some(OsmosisClIncentive {
                    incentive_id: record.incentive_id.to_string(),
                    denom: coin.denom,
                    remaining_amount: coin.amount,
                    emission_rate: body.emission_rate,
                    start_time: timestamp_to_string(body.start_time.as_ref()),
                })
            })
            .collect()
    })
    .unwrap_or_default();

    Ok(OsmosisPoolIncentives { gauges, cl_records })
}

pub async fn query_osmosis_pool_incentives(
    grpc_endpoints: &[chain::Grpc],
    pool_id: &str,
) -> anyhow::Result<OsmosisPoolIncentives> {
    let pool_id = parse_pool_id_value(pool_id)?;
    let mut last_error = None;

    for endpoint in prioritize_grpc_endpoints(grpc_endpoints).iter().take(3) {
        match query_osmosis_pool_incentives_grpc(endpoint, pool_id).await {
            Ok(result) => return Ok(result),
            Err(e) => {
                log::warn!("Failed Osmosis incentives gRPC query with endpoint {endpoint}: {e}");
                last_error = Some(e);
            }
        }
    }

    Err(last_error.unwrap_or_else(|| anyhow::anyhow!("No valid Osmosis gRPC endpoint available")))
}

async fn query_osmosis_denom_spot_price_grpc(
    grpc_endpoint: &str,
    denom: &str,
) -> anyhow::Result<QueryDenomSpotPriceResponse> {
    grpc_unary(
        connect_grpc(grpc_endpoint).await?,
        "/osmosis.txfees.v1beta1.Query/DenomSpotPrice",
        QueryDenomSpotPriceRequest {
            denom: denom.to_string(),
        },
    )
    .await
}

async fn query_osmosis_denom_spot_price_grpc_first(
    grpc_endpoints: &[chain::Grpc],
    denom: &str,
) -> anyhow::Result<QueryDenomSpotPriceResponse> {
    let mut last_error = None;

    for endpoint in prioritize_grpc_endpoints(grpc_endpoints).iter().take(3) {
        match query_osmosis_denom_spot_price_grpc(endpoint, denom).await {
            Ok(result) => return Ok(result),
            Err(e) => {
                log::warn!("Failed Osmosis txfees gRPC query with endpoint {endpoint}: {e}");
                last_error = Some(e);
            }
        }
    }

    Err(last_error.unwrap_or_else(|| anyhow::anyhow!("No valid Osmosis gRPC endpoint available")))
}

async fn query_osmosis_token_price_sqs(
    metadata: &Value,
    token: &str,
) -> anyhow::Result<OsmosisTokenPrice> {
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(10))
        .build()?;
    let token_metadata = resolve_token_metadata(metadata, token).unwrap_or_else(|| {
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
    let quote_metadata = resolve_token_metadata(metadata, quote_denom);

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

async fn fetch_osmosis_token_metadata() -> Option<Value> {
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(10))
        .build()
        .ok()?;

    get_json(&client, "https://sqs.osmosis.zone/tokens/metadata")
        .await
        .ok()
}

fn looks_like_base_denom(token: &str) -> bool {
    let token = token.trim();
    token.contains('/') || token.starts_with('u')
}

pub async fn query_osmosis_token_price(
    grpc_endpoints: &[chain::Grpc],
    token: &str,
) -> anyhow::Result<OsmosisTokenPrice> {
    let trimmed = token.trim().to_string();
    let mut metadata = if looks_like_base_denom(&trimmed) {
        None
    } else {
        fetch_osmosis_token_metadata().await
    };
    let token_metadata = metadata
        .as_ref()
        .and_then(|metadata| resolve_token_metadata(metadata, token));
    let denom = token_metadata
        .as_ref()
        .map(|metadata| metadata.denom.clone())
        .unwrap_or_else(|| trimmed.clone());

    match query_osmosis_denom_spot_price_grpc_first(grpc_endpoints, &denom).await {
        Ok(price) => Ok(OsmosisTokenPrice {
            name: token_metadata
                .as_ref()
                .map(|metadata| metadata.name.clone())
                .unwrap_or_else(|| trimmed.clone()),
            symbol: token_metadata
                .as_ref()
                .map(|metadata| metadata.symbol.clone())
                .unwrap_or_else(|| trimmed.clone()),
            denom,
            quote_symbol: "OSMO".to_string(),
            quote_denom: "uosmo".to_string(),
            price: price.spot_price,
        }),
        Err(grpc_error) => {
            if metadata.is_none() {
                metadata = fetch_osmosis_token_metadata().await;
            }
            if let Some(metadata) = metadata {
                log::warn!(
                    "Falling back to SQS token price after gRPC price failure: {grpc_error}"
                );
                query_osmosis_token_price_sqs(&metadata, token).await
            } else {
                Err(grpc_error)
            }
        }
    }
}

pub fn format_osmosis_pool_info(pool_id: &str, pool: &OsmosisPoolInfo) -> String {
    let mut message = format!("Osmosis Pool {pool_id}\nType: {}\n", pool.pool_type);

    if let Some(address) = &pool.address {
        message.push_str(&format!("Address: {address}\n"));
    }
    if let Some(swap_fee) = &pool.swap_fee {
        message.push_str(&format!("Swap Fee: {swap_fee}\n"));
    }
    if let Some(total_shares) = &pool.total_shares {
        message.push_str(&format!("Total Shares: {}\n", format_amount(total_shares)));
    }

    if !pool.assets.is_empty() {
        message.push_str("\nAssets:\n");
        for asset in pool.assets.iter().take(8) {
            if asset.amount.is_empty() {
                message.push_str(&format!("- {}\n", truncate_ibc_hash(&asset.denom)));
            } else if let Some(weight) = &asset.weight {
                message.push_str(&format!(
                    "- {}: {} (weight {})\n",
                    truncate_ibc_hash(&asset.denom),
                    format_amount(&asset.amount),
                    weight
                ));
            } else {
                message.push_str(&format!(
                    "- {}: {}\n",
                    truncate_ibc_hash(&asset.denom),
                    format_amount(&asset.amount)
                ));
            }
        }
    }

    if let Some(liquidity) = &pool.current_tick_liquidity {
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
