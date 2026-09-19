/**
 * Provider abstraction for KRA eTIMS receipt OCR extraction.
 *
 * The real provider would call an external OCR API (configured via
 * OCR_PROVIDER_URL). The mock provider extracts data from the QR code
 * payload when available, otherwise returns a minimal result.
 */

export interface OcrExtractionResult {
  /** Whether extraction was successful */
  success: boolean;
  /** Extracted fields */
  fields?: {
    kraInvoiceNumber?: string;
    invoiceDate?: string;
    amount?: string;
    vatAmount?: string;
    supplierTin?: string;
    supplierName?: string;
    kraControlUnitId?: string;
    kraQrCodeData?: string;
  };
  /** Error message if extraction failed */
  error?: string;
}

export interface OcrProvider {
  extractInvoiceData(fileKey: string, qrData?: string | null): Promise<OcrExtractionResult>;
}

/**
 * Mock OCR provider — extracts structured data from the QR code payload
 * when available. Without a real OCR service, this provides a best-effort
 * extraction from the captured QR string (which typically contains pipe-
 * delimited or JSON fields from the KRA receipt).
 */
export class MockOcrProvider implements OcrProvider {
  async extractInvoiceData(
    fileKey: string,
    qrData?: string | null,
  ): Promise<OcrExtractionResult> {
    if (!qrData || qrData.length < 20) {
      return {
        success: false,
        error: 'No QR data available for extraction',
      };
    }

    try {
      // Try JSON parse first (some QR payloads are JSON)
      const parsed = JSON.parse(qrData);
      return {
        success: true,
        fields: {
          kraInvoiceNumber: parsed.invoiceNo ?? parsed.invoice_number ?? undefined,
          invoiceDate: parsed.date ?? parsed.invoiceDate ?? undefined,
          amount: String(parsed.amount ?? parsed.total ?? ''),
          vatAmount: String(parsed.vat ?? parsed.vatAmount ?? '0'),
          supplierTin: parsed.tin ?? parsed.supplierTin ?? undefined,
          supplierName: parsed.name ?? parsed.supplierName ?? undefined,
          kraControlUnitId: parsed.controlUnitId ?? parsed.kraControlUnitId ?? undefined,
          kraQrCodeData: qrData,
        },
      };
    } catch {
      // Not JSON — try pipe-delimited format
      const parts = qrData.split('|').map((p) => p.trim());
      if (parts.length >= 4) {
        return {
          success: true,
          fields: {
            kraInvoiceNumber: parts[0] || undefined,
            invoiceDate: parts[1] || undefined,
            amount: parts[2] || '0',
            vatAmount: parts[3] || '0',
            supplierTin: parts[4] || undefined,
            supplierName: parts[5] || undefined,
            kraQrCodeData: qrData,
          },
        };
      }

      return {
        success: false,
        error: 'QR data format not recognized',
      };
    }
  }
}

/**
 * HTTP OCR provider — calls an external OCR service (OCR_PROVIDER_URL).
 * Falls back to the mock provider when the URL is not configured.
 */
export class HttpOcrProvider implements OcrProvider {
  constructor(private readonly baseUrl: string) {}

  async extractInvoiceData(
    fileKey: string,
    qrData?: string | null,
  ): Promise<OcrExtractionResult> {
    try {
      const response = await fetch(`${this.baseUrl}/extract`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fileKey, qrData }),
        signal: AbortSignal.timeout(30_000),
      });

      if (!response.ok) {
        return { success: false, error: `OCR provider returned ${response.status}` };
      }

      return (await response.json()) as OcrExtractionResult;
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      return { success: false, error: `OCR provider error: ${message}` };
    }
  }
}
