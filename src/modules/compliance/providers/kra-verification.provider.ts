/**
 * Provider abstraction for KRA eTIMS invoice verification.
 *
 * The real provider would call the KRA PIN Verification API (KRA_PIN_VERIFY_URL).
 * The mock provider performs self-consistency validation on the QR payload.
 */

export interface KraVerificationResult {
  /** Whether the invoice is verified as valid with KRA */
  verified: boolean;
  /** KRA-assigned control unit ID if returned */
  kraControlUnitId?: string;
  /** KRA-assigned serial number if returned */
  kraSerialNumber?: string;
  /** KRA-assigned invoice number if returned */
  kraInvoiceNumber?: string;
  /** Verification reason / error */
  reason?: string;
  /** Raw response from KRA API for audit trail */
  rawResponse?: Record<string, unknown>;
}

export interface KraVerificationProvider {
  /** Verify a single invoice or credit note QR payload against KRA */
  verifyInvoice(qrData: string, opts?: { tin?: string; amount?: string }): Promise<KraVerificationResult>;
  /** Batch-verify multiple QR payloads (optional; providers may not support this) */
  batchVerify?(items: Array<{ id: string; qrData: string; tin?: string; amount?: string }>): Promise<Map<string, KraVerificationResult>>;
}

/**
 * Mock provider — self-consistency check only.
 * Returns VERIFIED if the QR payload looks structurally valid (length + format),
 * otherwise returns a failure. No external calls are made.
 */
export class MockKraVerificationProvider implements KraVerificationProvider {
  async verifyInvoice(
    qrData: string,
    opts?: { tin?: string; amount?: string },
  ): Promise<KraVerificationResult> {
    if (!qrData || qrData.length < 20) {
      return { verified: false, reason: 'QR data too short or missing' };
    }

    // Self-consistency: if TIN is provided, check it appears in QR
    if (opts?.tin && !qrData.includes(opts.tin)) {
      return { verified: false, reason: `TIN ${opts.tin} not found in QR payload` };
    }

    // Self-consistency: if amount is provided, check it appears in QR
    if (opts?.amount && !qrData.includes(opts.amount)) {
      return { verified: false, reason: `Amount ${opts.amount} not found in QR payload` };
    }

    return {
      verified: true,
      reason: 'Self-consistency check passed (mock provider)',
    };
  }
}

/**
 * HTTP provider — calls the KRA PIN Verification API.
 * Falls back to the mock provider when KRA_PIN_VERIFY_URL is not configured.
 */
export class HttpKraVerificationProvider implements KraVerificationProvider {
  constructor(private readonly baseUrl: string) {}

  async verifyInvoice(
    qrData: string,
    opts?: { tin?: string; amount?: string },
  ): Promise<KraVerificationResult> {
    try {
      const response = await fetch(`${this.baseUrl}/verify`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ qrData, ...opts }),
        signal: AbortSignal.timeout(30_000),
      });

      if (!response.ok) {
        return { verified: false, reason: `KRA verification API returned ${response.status}` };
      }

      const data = (await response.json()) as KraVerificationResult;
      return {
        verified: data.verified,
        kraControlUnitId: data.kraControlUnitId,
        kraSerialNumber: data.kraSerialNumber,
        kraInvoiceNumber: data.kraInvoiceNumber,
        reason: data.reason,
        rawResponse: data.rawResponse,
      };
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      return { verified: false, reason: `KRA verification error: ${message}` };
    }
  }
}
