/**
 * Minimal money arithmetic for invoice totals. Amounts are small enough to be
 * represented exactly as 2-dp floats in the JS safe-integer range, but every
 * intermediate product is rounded to 2 decimal places at the point of use so
 * floating-point drift can never leak into stored documents.
 */

export function round2(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

/** Parse a decimal string (e.g. "1150.50") or number to a 2-dp float. */
export function toAmount(value: string | number): number {
  const n = typeof value === 'string' ? Number.parseFloat(value) : value;
  if (!Number.isFinite(n)) throw new RangeError(`Invalid monetary value: ${value}`);
  return round2(n);
}

/** qty * unitPrice, rounded to 2 dp — used for line amounts. */
export function multiply(a: string | number, b: string | number): number {
  return round2(toAmount(a) * toAmount(b));
}

/** Percentage reduction on a base amount, rounded to 2 dp. */
export function percentage(base: number, pct: number): number {
  return round2((base * pct) / 100);
}

/** Running sum of 2-dp values, rounded defensively. */
export function sum(values: number[]): number {
  return round2(values.reduce((acc, v) => acc + round2(v), 0));
}