interface Metric {
  command: string;
  timestamp: Date;
  userId: number;
}

const metrics: Metric[] = [];

export function collectMetric(command: string, userId: number): void {
  const metric: Metric = {
    command,
    timestamp: new Date(),
    userId,
  };
  metrics.push(metric);
  console.log(`[${metric.timestamp.toISOString()}] Collected metric: Command - ${metric.command}, User - ${metric.userId}`);
}

// Function to get collected metrics
export function getCollectedMetrics(): Metric[] {
  return metrics;
}
