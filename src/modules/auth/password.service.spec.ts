import { describe, expect, it } from 'vitest';
import { PasswordService } from './password.service.js';

describe('PasswordService', () => {
  const svc = new PasswordService();

  it('hashes and verifies a password round-trip', async () => {
    const hash = await svc.hash('SuperSecure123!');
    expect(hash).toMatch(/^\$argon2id\$/);
    await expect(svc.verify(hash, 'SuperSecure123!')).resolves.toBe(true);
  });

  it('rejects a wrong password', async () => {
    const hash = await svc.hash('right-password');
    await expect(svc.verify(hash, 'wrong-password')).resolves.toBe(false);
  });

  it('produces unique salts per hash', async () => {
    const a = await svc.hash('same-password');
    const b = await svc.hash('same-password');
    expect(a).not.toBe(b);
  });
});