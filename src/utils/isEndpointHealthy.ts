import { dns } from "dns";
import { https, http } from "follow-redirects";

const unhealthyEndpoints = new Set<string>();

// Helper function to perform a simple DNS lookup to check if the host is reachable.
function isHostReachable(hostname: string): Promise<boolean> {
  return new Promise((resolve) => {
    dns.lookup(hostname, (err) => {
      resolve(!err); // Resolves true if no error
    });
  });
}

export async function isEndpointHealthy(endpoint: string, isRpc: boolean): Promise<boolean> {
  // Immediately skip if endpoint starts with 'http://'
  if (endpoint.startsWith('http://') || unhealthyEndpoints.has(endpoint)) {
    console.log(`Skipping health check for endpoint with non-secure protocol or known to be unhealthy: ${endpoint}`);
    return false;
  }

  try {
    const hostname = new URL(endpoint).hostname;

    if (!await isHostReachable(hostname)) {
      console.log(`${endpoint} is not reachable.`);
      unhealthyEndpoints.add(endpoint);
      return false;
    }

    const basePath = isRpc ? '/status' : '/cosmos/base/tendermint/v1beta1/blocks/latest';
    const url = new URL(basePath, endpoint.replace(/([^:]\/)\/+/g, "$1")).href;

    const protocol = endpoint.startsWith('https') ? https : http;
    const requestTimeout = 5000;

    return new Promise<boolean>((resolve) => {
      const request = protocol.get(url, (resp) => {
        let data = '';
        resp.on('data', (chunk) => { data += chunk; });
        resp.on('end', () => {
          try {
            const jsonData = JSON.parse(data);
            const latestBlockTimeString = isRpc ? jsonData.result?.sync_info?.latest_block_time : jsonData.block?.header?.time;
            const latestBlockTime = latestBlockTimeString ? new Date(latestBlockTimeString) : null;
            resolve(latestBlockTime ? (new Date().getTime() - latestBlockTime.getTime()) < 60000 : false);
          } catch {
            unhealthyEndpoints.add(endpoint);
            resolve(false);
          }
        });
      }).on("error", () => {
        unhealthyEndpoints.add(endpoint);
        resolve(false);
      });

      request.setTimeout(requestTimeout, () => {
        request.abort();
        unhealthyEndpoints.add(endpoint);
        resolve(false);
      });
    });
  } catch (error) {
    console.error(`Error processing endpoint ${endpoint}: ${error.message}`);
    unhealthyEndpoints.add(endpoint);
    return false;
  }
}
