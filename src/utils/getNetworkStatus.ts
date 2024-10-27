import fetch from "node-fetch";

// Define the expected structure of the response from the /status endpoint
interface NetworkStatusResponse {
  result: {
    sync_info: {
      latest_block_height: string;
      latest_block_time: string;
      catching_up: boolean;
    };
  };
}

// Update the function to use proper typing
export async function getNetworkStatus(rpcUrl: string): Promise<{
  latestBlockHeight: string;
  latestBlockTime: string;
  catchingUp: boolean;
} | null> {
  const statusEndpoint = `${rpcUrl}/status`;

  try {
    const response = await fetch(statusEndpoint);
    if (!response.ok) {
      throw new Error(`Failed to fetch network status from ${rpcUrl}`);
    }

    // Type assertion for JSON response
    const data = (await response.json()) as NetworkStatusResponse;

    return {
      latestBlockHeight: data.result.sync_info.latest_block_height,
      latestBlockTime: data.result.sync_info.latest_block_time,
      catchingUp: data.result.sync_info.catching_up,
    };
  } catch (error) {
    // Type assertion for error to let TypeScript know it's of type Error
    const errorMessage = (error as Error).message;
    console.error(`[${new Date().toISOString()}] Error fetching network status from ${rpcUrl}: ${errorMessage}`);
    return null;
  }
}
