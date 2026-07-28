export type HealthStatus = 'OK' | 'Partially Available' | 'Unavailable';

export interface StatusCheck {
  name: string;
  status: string;
  details?: unknown;
  message?: string;
}

export interface StatusResponseSchemaDTO {
  status: string;
  timestamp: string;
  version: string;
  metadata?: unknown;
  checks: StatusCheck[];
}