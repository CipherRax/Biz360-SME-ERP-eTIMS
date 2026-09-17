import type { Role } from '@/types/domain';

export interface AccessClaims {
  sub: string;
  email: string;
  role: Role;
  orgId: string;
  tokenVersion?: string;
  exp?: number;
  iat?: number;
}

// Decode (do NOT verify) the access token payload. The backend verifies the
// signature on every request; we only read claims to mirror the session in the
// UI and to gate routes at the edge. Works in both edge and node runtimes.
export function decodeAccessToken(token: string): AccessClaims | null {
  const part = token.split('.')[1];
  if (!part) return null;
  try {
    const base64 = part.replace(/-/g, '+').replace(/_/g, '/');
    const padded = base64.padEnd(base64.length + ((4 - (base64.length % 4)) % 4), '=');
    const binary = atob(padded);
    const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
    const json = new TextDecoder().decode(bytes);
    const claims = JSON.parse(json) as AccessClaims;
    if (!claims.sub || !claims.role) return null;
    return claims;
  } catch {
    return null;
  }
}