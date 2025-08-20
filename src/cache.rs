use chain_registry::get::{AssetList, ChainInfo, IBCPath};
use dashmap::DashMap;
use std::time::{Duration, Instant};

pub struct CachedItem<T> {
    data: T,
    timestamp: Instant,
}

pub struct RegistryCache {
    chains: DashMap<String, CachedItem<ChainInfo>>,
    assets: DashMap<String, CachedItem<AssetList>>,
    paths: DashMap<String, CachedItem<IBCPath>>,
    ttl: Duration,
}

impl RegistryCache {
    pub fn new(ttl_minutes: u64) -> Self {
        Self {
            chains: DashMap::new(),
            assets: DashMap::new(),
            paths: DashMap::new(),
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
        let chain = chain_registry::get::get_chain(name).await?;
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
        let assets = chain_registry::get::get_assets(name).await?;
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

    pub async fn get_path(
        &self,
        chain_a: &str,
        chain_b: &str,
    ) -> anyhow::Result<Option<IBCPath>> {
        let key = format!("{}-{}", chain_a.min(chain_b), chain_a.max(chain_b));

        // Check cache first
        if let Some(cached) = self.paths.get(&key) {
            if cached.timestamp.elapsed() < self.ttl {
                return Ok(Some(cached.data.clone()));
            } else {
                drop(cached);
                self.paths.remove(&key);
            }
        }

        // Fetch from registry
        let path = chain_registry::get::get_path(chain_a, chain_b).await?;
        if let Some(ref p) = path {
            self.paths.insert(
                key,
                CachedItem {
                    data: p.clone(),
                    timestamp: Instant::now(),
                },
            );
        }
        Ok(path)
    }

    pub async fn list_chains(&self) -> anyhow::Result<Vec<String>> {
        chain_registry::get::list_chains().await.map_err(Into::into)
    }

    pub async fn list_paths(&self) -> anyhow::Result<Vec<String>> {
        chain_registry::get::list_paths().await.map_err(Into::into)
    }
}