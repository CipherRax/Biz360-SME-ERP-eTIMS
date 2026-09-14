/** Payload of pino-http device metadata for tokens. */
export interface DeviceContext {
  userAgent?: string;
  ipAddress?: string;
}

export function deviceContextFrom(headers: Record<string, string | string[] | undefined>, ip?: string): DeviceContext {
  return {
    userAgent: typeof headers['user-agent'] === 'string' ? headers['user-agent'] : undefined,
    ipAddress: ip,
  };
}