export interface HealthStatus {
  /** `ok` only when every dependency is up. */
  status: 'ok' | 'error';
  database: 'up' | 'down';
  timestamp: string;
  /** Process uptime in seconds. */
  uptime: number;
}

/** Liveness only says the process runs; it never reports on dependencies. */
export type LivenessStatus = Omit<HealthStatus, 'database'>;
