import { decodeAccessToken } from './jwt';

function makeToken(payload: Record<string, unknown>): string {
  const encode = (value: object) =>
    Buffer.from(JSON.stringify(value))
      .toString('base64')
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');
  const header = encode({ alg: 'HS256', typ: 'JWT' });
  const body = encode(payload);
  return `${header}.${body}.signature`;
}

describe('decodeAccessToken', () => {
  it('extracts claims from a well-formed token', () => {
    const token = makeToken({
      sub: 'user-1',
      email: 'jane@acme.co.ke',
      role: 'ACCOUNTANT',
      orgId: 'org-9',
      exp: 9_999_999_999,
    });

    expect(decodeAccessToken(token)).toMatchObject({
      sub: 'user-1',
      email: 'jane@acme.co.ke',
      role: 'ACCOUNTANT',
      orgId: 'org-9',
    });
  });

  it('returns null when the payload has no sub or role', () => {
    expect(decodeAccessToken(makeToken({ email: 'x@y.z' }))).toBeNull();
  });

  it('returns null for malformed tokens', () => {
    expect(decodeAccessToken('not-a-jwt')).toBeNull();
    expect(decodeAccessToken('a.b.c')).toBeNull();
    expect(decodeAccessToken('')).toBeNull();
  });
});