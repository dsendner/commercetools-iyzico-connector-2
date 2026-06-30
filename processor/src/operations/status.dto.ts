export type HealthStatus = 'OK' | 'Partially Available' | 'Unavailable';

export interface StatusMetadata {
  name: string;
  description: string;
  version?: string;
}

export interface StatusResponse {
  metadata: StatusMetadata;
  status: HealthStatus;
  timestamp: string;
}