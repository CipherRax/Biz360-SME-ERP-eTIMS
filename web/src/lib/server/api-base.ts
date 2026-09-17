// Server-only. Never imported by client components — `API_BASE_URL` must not
// be exposed to the browser bundle (that's what NEXT_PUBLIC_API_BASE_URL is for).
export function backendApiBase(): string {
  const origin = (process.env.API_BASE_URL ?? 'http://localhost:3000').replace(/\/$/, '');
  return `${origin}/api/v1`;
}

export function jsonError(status: number, message: string) {
  return {
    success: false,
    data: null,
    message,
    timestamp: new Date().toISOString(),
    errors: [] as Array<{ message: string; path?: string }>,
  };
}