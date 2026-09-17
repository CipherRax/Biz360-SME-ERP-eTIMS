// Currency-safe formatting. The backend sends decimals as numbers in
// responses; never do float arithmetic for display — format, don't compute.

const CURRENCY_SYMBOL: Record<string, string> = {
  KES: 'KSh',
  USD: '$',
  EUR: '€',
  GBP: '£',
  UGX: 'USh',
  TZS: 'TSh',
};

export function formatMoney(
  value: number | string | null | undefined,
  currency = 'KES',
): string {
  if (value === null || value === undefined || value === '') return '—';
  const amount = typeof value === 'string' ? Number(value) : value;
  if (Number.isNaN(amount)) return '—';
  const symbol = CURRENCY_SYMBOL[currency] ?? currency;
  const formatted = new Intl.NumberFormat('en-KE', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amount);
  return `${symbol} ${formatted}`;
}

export function formatNumber(value: number | null | undefined, digits = 2): string {
  if (value === null || value === undefined) return '—';
  return new Intl.NumberFormat('en-KE', {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(value);
}

export function formatDate(value: string | Date | null | undefined): string {
  if (!value) return '—';
  const date = typeof value === 'string' ? new Date(value) : value;
  if (Number.isNaN(date.getTime())) return '—';
  return new Intl.DateTimeFormat('en-KE', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  }).format(date);
}

export function formatDateTime(value: string | Date | null | undefined): string {
  if (!value) return '—';
  const date = typeof value === 'string' ? new Date(value) : value;
  if (Number.isNaN(date.getTime())) return '—';
  return new Intl.DateTimeFormat('en-KE', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}

export function relativeTime(value: string | Date): string {
  const date = typeof value === 'string' ? new Date(value) : value;
  const diffMs = Date.now() - date.getTime();
  const seconds = Math.round(diffMs / 1000);
  const units: [Intl.RelativeTimeFormatUnit, number][] = [
    ['second', 60],
    ['minute', 60],
    ['hour', 24],
    ['day', 7],
    ['week', 4.345],
    ['month', 12],
    ['year', Number.POSITIVE_INFINITY],
  ];
  let value_ = seconds;
  for (const [unit, divisor] of units) {
    if (Math.abs(value_) < divisor) {
      return new Intl.RelativeTimeFormat('en', { numeric: 'auto' }).format(
        -Math.round(value_),
        unit,
      );
    }
    value_ /= divisor;
  }
  return formatDate(date);
}

export function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? '')
    .join('');
}