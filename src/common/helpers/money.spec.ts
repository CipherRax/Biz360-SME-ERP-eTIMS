import { describe, expect, it } from 'vitest';
import { multiply, percentage, round2, sum, toAmount } from './money.js';

describe('money helpers', () => {
  it('rounds to 2 decimal places without floating-point drift', () => {
    expect(round2(0.1 + 0.2)).toBe(0.3);
    expect(round2(1.005)).toBe(1.01);
    expect(round2(2.555)).toBe(2.56);
    expect(round2(1.004)).toBe(1.0);
  });

  it('parses decimal strings and numbers', () => {
    expect(toAmount('1150.50')).toBe(1150.5);
    expect(toAmount('0')).toBe(0);
    expect(toAmount(149.99)).toBe(149.99);
    expect(toAmount('10.125')).toBe(10.13);
  });

  it('rejects non-finite values', () => {
    expect(() => toAmount('abc')).toThrow(RangeError);
    expect(() => toAmount(Number.NaN)).toThrow(RangeError);
  });

  it('multiplies quantity by unit price with 2-dp rounding', () => {
    expect(multiply('10.00', '11.50')).toBe(115);
    expect(multiply(3, 1.15)).toBe(3.45);
    expect(multiply('33.33', '3.00')).toBe(99.99);
  });

  it('computes percentage-of-base with rounding', () => {
    expect(percentage(20000, 16)).toBe(3200);
    expect(percentage(99.99, 16)).toBe(16.0);
    expect(percentage(1, 0)).toBe(0);
  });

  it('sums 2-dp values defensively', () => {
    expect(sum([0.1, 0.2, 0.3, 0.4])).toBe(1);
    expect(sum([1150.5, 1150.5])).toBe(2301);
    expect(sum([])).toBe(0);
  });
});