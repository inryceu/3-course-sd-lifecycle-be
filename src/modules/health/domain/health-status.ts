export interface HealthStatus {
  /** `ok` only when every dependency is up. */
  status: 'ok' | 'error';
  database: 'up' | 'down';
  timestamp: string;
  /** Process uptime in seconds. */
  uptime: number;
}
