const unhealthyEndpoints = new Set<string>();

export function recoverEndpoint(endpoint: string): void {
  unhealthyEndpoints.delete(endpoint);
}
