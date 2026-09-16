/**
 * Format an invoice/order number using a format string like:
 * INV-{YYYY}-{SEQ:6}, QT-{YYYY}-{SEQ:6}, etc.
 * Tokens: {YYYY} = 4-digit year, {MM} = 2-digit month, {DD} = 2-digit day, {SEQ:n} = zero-padded sequence.
 */
export function formatDocumentNumber(
  format: string,
  sequence: number,
  date: Date = new Date(),
): string {
  const year = date.getFullYear().toString();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');

  return format
    .replace(/\{YYYY\}/g, year)
    .replace(/\{MM\}/g, month)
    .replace(/\{DD\}/g, day)
    .replace(/\{SEQ:(\d+)\}/g, (_, width: string) => String(sequence).padStart(parseInt(width, 10), '0'));
}
