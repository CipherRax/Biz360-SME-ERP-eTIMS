// The access token lives ONLY in memory (module state). It is never written to
// localStorage/sessionStorage, so an injected script cannot exfiltrate a
// long-lived credential. A full page reload drops it and the app silently
// refreshes from the httpOnly refresh cookie.

type Listener = () => void;

let accessToken: string | null = null;
let expiresAt = 0;

const listeners = new Set<Listener>();

function notify(): void {
  for (const listener of listeners) listener();
}

export const tokenStore = {
  get(): string | null {
    return accessToken;
  },

  isExpired(skewSeconds = 15): boolean {
    if (!accessToken) return true;
    return Date.now() >= expiresAt - skewSeconds * 1000;
  },

  set(token: string, expiresInSeconds: number): void {
    accessToken = token;
    expiresAt = Date.now() + expiresInSeconds * 1000;
    notify();
  },

  clear(): void {
    accessToken = null;
    expiresAt = 0;
    notify();
  },

  subscribe(listener: Listener): () => void {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
};