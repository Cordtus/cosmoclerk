import { getCollectedMetrics } from './collectMetrics';

export function setupMetricsLoggingJob(intervalMinutes: number): void {
  setInterval(() => {
    const metrics = getCollectedMetrics();
    console.log(`[${new Date().toISOString()}] Metrics Snapshot:`, metrics);
  }, intervalMinutes * 60000); // Convert minutes to milliseconds
}
