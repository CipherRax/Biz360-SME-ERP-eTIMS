/**
 * Provider abstraction for mobile-money payments (M-Pesa / Airtel Money /
 * T-Kash). Every provider implements the same narrow contract so adding a new
 * provider is a config + adapter change.
 *
 * The mock provider simulates an STK-Push receipt without any live integration;
 * HTTP providers are selected by env config (e.g. DARAJA_* / AIRTEL_* / TKASH_*).
 */

export type MobileMoneyProviderName = 'MPESA' | 'AIRTEL_MONEY' | 'TKASH';

export interface InitiateMobileMoneyPaymentInput {
  organizationId: string;
  provider: MobileMoneyProviderName;
  amount: number;
  phoneNumber?: string;
  accountReference: string;
  transactionDesc?: string;
}

export interface InitiateMobileMoneyPaymentResult {
  providerTransactionId: string;
  status: 'PENDING' | 'SUCCESS' | 'FAILED';
  /** Human-readable detail (e.g. mock receipt reference). */
  detail?: string;
}

export interface MobileMoneyPaymentStatusResult {
  providerTransactionId: string;
  status: 'PENDING' | 'SUCCESS' | 'FAILED';
  /** Provider receipts usually carry a confirmation/M-Pesa code here. */
  confirmationCode?: string;
}

export interface MobileMoneyCallbackResult {
  providerTransactionId: string;
  amount: number | null;
  phoneNumberMasked: string | null;
  confirmationCode: string | null;
  rawPayload: Record<string, unknown>;
}

export interface MobileMoneyProvider {
  readonly name: MobileMoneyProviderName;
  initiatePayment(
    input: InitiateMobileMoneyPaymentInput,
  ): Promise<InitiateMobileMoneyPaymentResult>;
  queryStatus(
    providerTransactionId: string,
  ): Promise<MobileMoneyPaymentStatusResult>;
  /** Validate + normalize an incoming webhook callback for this provider. */
  parseCallback(payload: Record<string, unknown>): MobileMoneyCallbackResult | null;
}

function generateProviderTransactionId(prefix: string): string {
  const rand = Math.random().toString(36).slice(2, 10).toUpperCase();
  return `${prefix}${Date.now().toString().slice(-8)}${rand}`;
}

/** Deterministic fake confirmation code, stable per transaction id. */
function mockCode(transactionId: string): string {
  let hash = 0;
  for (let i = 0; i < transactionId.length; i += 1) {
    hash = (hash * 31 + transactionId.charCodeAt(i)) >>> 0;
  }
  return `MP${(hash % 100000000).toString().padStart(8, '0')}`;
}

/**
 * Simulates an STK-Push: instantly SUCCESS with a mock MPesa-style code. Used
 * when no live provider credentials are configured (dev/demo and offline-first
 * local testing).
 */
export class MockMobileMoneyProvider implements MobileMoneyProvider {
  constructor(readonly name: MobileMoneyProviderName = 'MPESA') {}

  async initiatePayment(
    input: InitiateMobileMoneyPaymentInput,
  ): Promise<InitiateMobileMoneyPaymentResult> {
    const providerTransactionId = generateProviderTransactionId('MM');
    return {
      providerTransactionId,
      status: 'SUCCESS',
      detail: `Mock ${input.provider} payment accepted for ${input.accountReference}`,
    };
  }

  async queryStatus(
    providerTransactionId: string,
  ): Promise<MobileMoneyPaymentStatusResult> {
    return {
      providerTransactionId,
      status: 'SUCCESS',
      confirmationCode: mockCode(providerTransactionId),
    };
  }

  parseCallback(payload: Record<string, unknown>): MobileMoneyCallbackResult | null {
    const id = (payload as { transactionId?: string }).transactionId;
    if (!id) return null;
    return {
      providerTransactionId: String(id),
      amount: payload.amount != null ? Number(payload.amount) : null,
      phoneNumberMasked: null,
      confirmationCode: mockCode(String(id)),
      rawPayload: payload,
    };
  }
}

/**
 * HTTP provider for a live aggregator (Daraja / Airtel / T-Kash). Falls back to
 * the mock behavior through the caller when the URL is not configured.
 */
export class HttpMobileMoneyProvider implements MobileMoneyProvider {
  constructor(
    readonly name: MobileMoneyProviderName,
    private readonly baseUrl: string,
    private readonly apiKey?: string,
  ) {}

  async initiatePayment(
    input: InitiateMobileMoneyPaymentInput,
  ): Promise<InitiateMobileMoneyPaymentResult> {
    const response = await fetch(`${this.baseUrl}/pay`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(this.apiKey ? { Authorization: `Bearer ${this.apiKey}` } : {}),
      },
      body: JSON.stringify(input),
      signal: AbortSignal.timeout(30_000),
    });
    if (!response.ok) {
      return {
        providerTransactionId: generateProviderTransactionId('MM'),
        status: 'FAILED',
        detail: `Provider returned ${response.status}`,
      };
    }
    return (await response.json()) as InitiateMobileMoneyPaymentResult;
  }

  async queryStatus(
    providerTransactionId: string,
  ): Promise<MobileMoneyPaymentStatusResult> {
    const response = await fetch(`${this.baseUrl}/status/${providerTransactionId}`, {
      signal: AbortSignal.timeout(30_000),
    });
    if (!response.ok) return { providerTransactionId, status: 'FAILED' };
    return (await response.json()) as MobileMoneyPaymentStatusResult;
  }

  parseCallback(payload: Record<string, unknown>): MobileMoneyCallbackResult | null {
    const id = (payload as { transactionId?: string }).transactionId;
    if (!id) return null;
    return {
      providerTransactionId: String(id),
      amount: payload.amount != null ? Number(payload.amount) : null,
      phoneNumberMasked: (payload as { phoneNumberMasked?: string }).phoneNumberMasked ?? null,
      confirmationCode: (payload as { confirmationCode?: string }).confirmationCode ?? null,
      rawPayload: payload,
    };
  }
}