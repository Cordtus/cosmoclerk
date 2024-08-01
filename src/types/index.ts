// HTTP Request Types
export interface HttpResponse<T = any> {
  data: T;
  status: number;
  statusText: string;
  headers: Record<string, string>;
}

export interface HttpError extends Error {
  response?: HttpResponse;
}

// Chain Types
export interface ChainInfo {
  chain_name: string;
  chain_id: string;
  bech32_prefix: string;
  slip44: number;
  apis: {
    rpc: Endpoint[];
    rest: Endpoint[];
    grpc: Endpoint[];
  };
  explorers: Explorer[];
}

export interface Endpoint {
  address: string;
  provider: string;
}

export interface Explorer {
  kind: string;
  url: string;
  tx_page?: string;
}

export interface AssetInfo {
  denom_units: DenomUnit[];
  base: string;
  name: string;
  display: string;
  symbol: string;
  logo_URIs?: {
    png?: string;
    svg?: string;
  };
  coingecko_id?: string;
}

export interface DenomUnit {
  denom: string;
  exponent: number;
}

// Peer Types
export interface PeerInfo {
  id: string;
  address: string;
  provider?: string;
}

export interface PeerNodes {
  seeds: PeerInfo[];
  persistent_peers: PeerInfo[];
}

// Pool Types
export interface PoolInfo {
  id: string;
  type: string;
  assets: PoolAsset[];
  swap_fee: string;
}

export interface PoolAsset {
  token: {
    denom: string;
    amount: string;
  };
  weight: string;
}

// User Session Types
export interface UserAction {
  chain?: string;
  messageId?: number;
  chatId?: number;
  browsingTestnets?: boolean;
  testnetsList?: string[];
  timestamp: Date;
}

export interface ExpectedAction {
  type: 'awaiting_pool_id' | 'awaiting_token_ticker' | 'awaiting_ibc_denom';
}

// Bot Types
export interface BotContext extends Context {
  session: {
    userAction: UserAction;
    expectedAction: ExpectedAction;
  };
}

// Config Types
export interface AppConfig {
  BOT_TOKEN: string;
  REPO_URL: string;
  REPO_DIR: string;
  STALE_HOURS: number;
  UPDATE_INTERVAL: number;
  PAGE_SIZE: number;
}

// Utility Types
export type AsyncFunction<T = void> = (...args: any[]) => Promise<T>;

export interface PaginationResult<T> {
  items: T[];
  totalPages: number;
  currentPage: number;
}