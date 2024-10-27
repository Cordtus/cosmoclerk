export function handleError(message: string, error: any): void {
  console.error(`[${new Date().toISOString()}] ${message}: ${error.message}`);
}
