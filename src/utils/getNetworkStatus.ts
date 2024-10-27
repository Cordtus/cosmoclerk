import fetch from "node-fetch";

export async function getNetworkStatus(rpcUrl: string): Promise<any> {
  const statusEndpoint = `${rpcUrl}/status`;

  try {
    const response = await fetch(statusEndpoint);
    if (!response.ok) {
      throw new Error(`Failed to fetch network status from ${rpcUrl}`);
    }

    const data = await response.json();
    return {
      latestBlockHeight: data.result.sync_info.latest_block_height,
      latestBlockTime: data.result.sync_info.latest_block_time,
      catchingUp: data.result.sync_info.catching_up,
    };
  } catch (error) {
    console.error(`[${new Date().toISOString()}] Error fetching network status from ${rpcUrl}: ${error.message}`);
    return null;
  }
}
