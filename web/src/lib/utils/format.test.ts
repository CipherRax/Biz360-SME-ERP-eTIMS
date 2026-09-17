import { formatDate, formatMoney, formatNumber, initials, relativeTime } from './format';

describe('formatMoney', () => {
  it('formats KES with the KSh symbol and two decimals', () => {
    expect(formatMoney(1500)).toBe('KSh 1,500.00');
  });

  it('accepts decimal strings from the API', () => {
    expect(formatMoney('2500.5')).toBe('KSh 2,500.50');
  });

  it('renders an em dash for empty or invalid values', () => {
    expect(formatMoney(null)).toBe('—');
    expect(formatMoney(undefined)).toBe('—');
    expect(formatMoney('')).toBe('—');
    expect(formatMoney('not-a-number')).toBe('—');
  });

  it('supports other currencies', () => {
    expect(formatMoney(10, 'USD')).toBe('$ 10.00');
  });
});

describe('formatNumber', () => {
  it('formats with the requested precision', () => {
    expect(formatNumber(1234.5)).toBe('1,234.50');
    expect(formatNumber(1234.5, 0)).toBe('1,235');
  });

  it('returns an em dash for nullish values', () => {
    expect(formatNumber(null)).toBe('—');
    expect(formatNumber(undefined)).toBe('—');
  });
});

describe('formatDate', () => {
  it('formats ISO dates', () => {
    expect(formatDate('2026-03-15T00:00:00.000Z')).toMatch(/2026/);
  });

  it('returns an em dash for invalid dates', () => {
    expect(formatDate('nope')).toBe('—');
    expect(formatDate(null)).toBe('—');
  });
});

describe('relativeTime', () => {
  it('describes recent times relatively', () => {
    const thirtySecondsAgo = new Date(Date.now() - 30_000).toISOString();
    expect(relativeTime(thirtySecondsAgo)).toMatch(/30 seconds ago/);
  });

  it('describes older dates by unit', () => {
    const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
    expect(relativeTime(twoHoursAgo)).toMatch(/2 hours ago/);
  });
});

describe('initials', () => {
  it('takes the first letter of the first two words', () => {
    expect(initials('Jane Wanjiku Kamau')).toBe('JW');
  });

  it('handles single names and extra whitespace', () => {
    expect(initials('  Acme  ')).toBe('A');
  });
});