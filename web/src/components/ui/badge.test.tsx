import { render } from '@testing-library/react';
import { Badge } from './badge';
import { etimsMeta, INVOICE_STATUS } from '@/lib/utils/status';

describe('Badge', () => {
  it('renders its content', () => {
    const { getByText } = render(<Badge>Draft</Badge>);
    expect(getByText('Draft')).toBeInTheDocument();
  });

  it('applies a tone-specific style', () => {
    const { getByText } = render(<Badge tone="success">Paid</Badge>);
    expect(getByText('Paid').className).toMatch(/text-success/);
  });
});

describe('status metadata', () => {
  it('maps invoice statuses to labels and tones', () => {
    expect(INVOICE_STATUS.CONFIRMED.label).toBe('Confirmed');
    expect(INVOICE_STATUS.CONFIRMED.tone).toBeTruthy();
  });

  it('treats an invoice without a submission timestamp as not submitted', () => {
    const meta = etimsMeta(null);
    expect(meta.label.toLowerCase()).toContain('not submitted');
    expect(meta.tone).toBe('warning');
  });

  it('treats an invoice with a submission timestamp as submitted', () => {
    const meta = etimsMeta('2026-01-01T10:00:00.000Z');
    expect(meta.label.toLowerCase()).toContain('submitted');
  });
});