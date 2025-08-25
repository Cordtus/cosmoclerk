use chain_registry::get::{AssetList, ChainInfo};
use dashmap::DashMap;
use std::time::{Duration, Instant};

pub struct CachedItem<T> {
    data: T,
    timestamp: Instant,
}

pub struct RegistryCache {
    chains: DashMap<String, CachedItem<ChainInfo>>,
    assets: DashMap<String, CachedItem<AssetList>>,
    chain_list: DashMap<String, CachedItem<Vec<String>>>,
    ttl: Duration,
}

impl RegistryCache {
    pub fn new(ttl_minutes: u64) -> Self {
        Self {
            chains: DashMap::new(),
            assets: DashMap::new(),
            chain_list: DashMap::new(),
            ttl: Duration::from_secs(ttl_minutes * 60),
        }
    }

    pub async fn get_chain(&self, name: &str) -> anyhow::Result<Option<ChainInfo>> {
        // Check cache first
        if let Some(cached) = self.chains.get(name) {
            if cached.timestamp.elapsed() < self.ttl {
                return Ok(Some(cached.data.clone()));
            } else {
                // Remove expired entry
                drop(cached);
                self.chains.remove(name);
            }
        }

        // Try mainnet first
        let chain = chain_registry::get::get_chain(name)
            .await
            .map_err(|e| anyhow::anyhow!(e.to_string()))?;
        
        // If not found, try testnets
        let chain = if chain.is_none() {
            chain_registry::get::get_chain(&format!("testnets/{}", name))
                .await
                .map_err(|e| anyhow::anyhow!(e.to_string()))?
        } else {
            chain
        };
        
        if let Some(ref c) = chain {
            self.chains.insert(
                name.to_string(),
                CachedItem {
                    data: c.clone(),
                    timestamp: Instant::now(),
                },
            );
        }
        Ok(chain)
    }

    pub async fn get_assets(&self, name: &str) -> anyhow::Result<Option<AssetList>> {
        // Check cache first
        if let Some(cached) = self.assets.get(name) {
            if cached.timestamp.elapsed() < self.ttl {
                return Ok(Some(cached.data.clone()));
            } else {
                drop(cached);
                self.assets.remove(name);
            }
        }

        // Try mainnet first
        let assets = chain_registry::get::get_assets(name)
            .await
            .map_err(|e| anyhow::anyhow!(e.to_string()))?;
        
        // If not found, try testnets
        let assets = if assets.is_none() {
            chain_registry::get::get_assets(&format!("testnets/{}", name))
                .await
                .map_err(|e| anyhow::anyhow!(e.to_string()))?
        } else {
            assets
        };
        
        if let Some(ref a) = assets {
            self.assets.insert(
                name.to_string(),
                CachedItem {
                    data: a.clone(),
                    timestamp: Instant::now(),
                },
            );
        }
        Ok(assets)
    }


    pub async fn list_chains(&self) -> anyhow::Result<Vec<String>> {
        // Check cache first
        if let Some(cached) = self.chain_list.get("mainnets") {
            if cached.timestamp.elapsed() < self.ttl {
                return Ok(cached.data.clone());
            } else {
                drop(cached);
                self.chain_list.remove("mainnets");
            }
        }

        // Fetch mainnet chains
        let chains = chain_registry::get::list_chains()
            .await
            .map_err(|e| anyhow::anyhow!(e.to_string()))?;
        
        // Filter out the testnets directory itself
        let chains: Vec<String> = chains.into_iter()
            .filter(|c| c != "testnets")
            .collect();
        
        self.chain_list.insert(
            "mainnets".to_string(),
            CachedItem {
                data: chains.clone(),
                timestamp: Instant::now(),
            },
        );
        
        Ok(chains)
    }
    
    pub async fn list_testnets(&self) -> anyhow::Result<Vec<String>> {
        // Check cache first
        if let Some(cached) = self.chain_list.get("testnets") {
            if cached.timestamp.elapsed() < self.ttl {
                return Ok(cached.data.clone());
            } else {
                drop(cached);
                self.chain_list.remove("testnets");
            }
        }

        // We need to fetch the contents of the testnets directory
        // Since the chain-registry crate doesn't support this directly,
        // we'll use the GitHub API
        let url = "https://api.github.com/repos/cosmos/chain-registry/contents/testnets";
        let client = reqwest::Client::new();
        let response = client
            .get(url)
            .header("User-Agent", "cosmoclerk-bot")
            .send()
            .await
            .map_err(|e| anyhow::anyhow!(e.to_string()))?;
        
        let contents: Vec<serde_json::Value> = response.json()
            .await
            .map_err(|e| anyhow::anyhow!(e.to_string()))?;
        
        let testnets: Vec<String> = contents
            .iter()
            .filter_map(|c| {
                if c["type"] == "dir" {
                    c["name"].as_str().map(|s| s.to_string())
                } else {
                    None
                }
            })
            .filter(|name| !name.starts_with('_') && !name.starts_with('.'))
            .collect();
        
        self.chain_list.insert(
            "testnets".to_string(),
            CachedItem {
                data: testnets.clone(),
                timestamp: Instant::now(),
            },
        );
        
        Ok(testnets)
    }
}