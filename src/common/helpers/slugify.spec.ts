import { describe, expect, it } from 'vitest';
import { slugify } from './slugify.js';

describe('slugify', () => {
  it('lowercases and trims', () => {
    expect(slugify('  Acme Trading CO  ')).toBe('acme-trading-co');
  });

  it('replaces non-alphanumeric runs with a single dash', () => {
    expect(slugify('Stanslaus & Sons -- Café')).toBe('stanslaus-sons-caf');
  });

  it('strips leading and trailing dashes', () => {
    expect(slugify('--hello world--')).toBe('hello-world');
  });

  it('caps the length at 60 characters', () => {
    const slug = slugify('x'.repeat(200));
    expect(slug.length).toBeLessThanOrEqual(60);
  });

  it('handles empty input', () => {
    expect(slugify('')).toBe('');
    expect(slugify('\t\n ')).toBe('');
  });
});