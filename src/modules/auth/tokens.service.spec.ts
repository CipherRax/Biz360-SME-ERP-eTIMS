import { describe, expect, it } from 'vitest';
import { TokensService } from './tokens.service.js';

function makeService(overrides?: Record<string, unknown>) {
  const config = {
    getOrThrow: (key: string) => {
      const values: Record<string, unknown> = {
        'auth.accessSecret': 'test-access-secret-that-is-long-enough',
        'auth.accessTtl': '15m',
        'auth.refreshTtl': '30d',
        ...overrides,
      };
      return values[key];
    },
  };
  const jwt = { sign: () => 'signed-token' };
  const prisma = { client: {} };
  return new TokensService(
    jwt as never,
    prisma as never,
    config as never,
  );
}

describe('TokensService', () => {
  it('hashes tokens deterministically with sha256 hex', () => {
    const svc = makeService();
    const token = 'opaque-refresh-token';
    const hash = svc.hashToken(token);
    expect(hash).toMatch(/^[a-f0-9]{64}$/);
    expect(svc.hashToken(token)).toBe(hash);
    expect(hash).not.toBe(token);
  });

  it('generates opaque 48-byte base64url refresh tokens with distinct hash', () => {
    const svc = makeService();
    const { token, hash } = svc.generateRefreshToken();
    expect(token).toMatch(/^[A-Za-z0-9_-]{64}$/);
    expect(hash).toBe(svc.hashToken(token));
    expect(hash).not.toBe(token);
    expect(svc.generateRefreshToken().token).not.toBe(token);
  });

  it('produces a version from sha256 of an empty input', () => {
    const svc = makeService();
    expect(svc.accessClientVersion()).toMatch(/^[a-f0-9]{8}$/);
  });

  it('parses ttl strings to seconds', () => {
    const svc = makeService() as TokensService & {
      parseTtlToSeconds: (ttl: string) => number;
    };
    expect(svc.parseTtlToSeconds('1s')).toBe(1);
    expect(svc.parseTtlToSeconds('90m')).toBe(5400);
    expect(svc.parseTtlToSeconds('2h')).toBe(7200);
    expect(svc.parseTtlToSeconds('7d')).toBe(604800);
  });

  it('falls back to 30 days for malformed ttl values', () => {
    const svc = makeService() as TokensService & {
      parseTtlToSeconds: (ttl: string) => number;
    };
    expect(svc.parseTtlToSeconds('garbage')).toBe(30 * 24 * 3600);
    expect(svc.parseTtlToSeconds('')).toBe(30 * 24 * 3600);
  });

  it('exposes refresh ttl in seconds from config', () => {
    const svc = makeService();
    expect(svc.refreshTtlSeconds()).toBe(30 * 24 * 3600);
  });
});