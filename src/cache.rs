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
    ttl: Duration,
}

impl RegistryCache {
    pub fn new(ttl_minutes: u64) -> Self {
        Self {
            chains: DashMap::new(),
            assets: DashMap::new(),
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

        // Fetch from registry
        let chain = chain_registry::get::get_chain(name)
            .await
            .map_err(|e| anyhow::anyhow!(e.to_string()))?;
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

        // Fetch from registry
        let assets = chain_registry::get::get_assets(name)
            .await
            .map_err(|e| anyhow::anyhow!(e.to_string()))?;
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
        chain_registry::get::list_chains()
            .await
            .map_err(|e| anyhow::anyhow!(e.to_string()))
    }
}