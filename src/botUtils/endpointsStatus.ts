export const unhealthyEndpoints = new Set<string>();

export function markEndpointUnhealthy(endpoint: string): void {
  unhealthyEndpoints.add(endpoint);
  console.log(
    `[${new Date().toISOString()}] Marked endpoint as unhealthy: ${endpoint}`,
  );
}

export function markEndpointHealthy(endpoint: string): void {
  unhealthyEndpoints.delete(endpoint);
  console.log(
    `[${new Date().toISOString()}] Marked endpoint as healthy: ${endpoint}`,
  );
}
