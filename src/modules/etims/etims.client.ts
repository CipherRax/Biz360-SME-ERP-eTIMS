import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash } from 'node:crypto';

export interface EtimsReceipt {
  ctrlNo: string;
  receipt: string;
  submittedAt: Date;
}

/**
 * KRA E-TIMS transport.
 *
 * `mock` mode (default in dev/test) synthesizes a valid-looking control number
 * and receipt with no network I/O so the entire pipeline — outbox, payload
 * building, receipt persistence — can run and be tested offline.
 *
 * `live` mode speaks the KRA TMS OAuth (`/v1/auth/token`) + `/v1/etims/invoice`
 * API. Point ETIMS_BASE_URL at the sandbox while integrating.
 */
@Injectable()
export class EtimsClient {
  private readonly logger = new Logger(EtimsClient.name);

  constructor(private readonly config: ConfigService) {}

  async submitInvoice(payload: Record<string, unknown>): Promise<EtimsReceipt> {
    if (this.isMock()) {
      // Deterministic per invoice number so re-submits are idempotent.
      const seed = `${payload.invoiceNumber ?? 'unknown'}`;
      const hash = createHash('sha256').update(seed).digest('hex').slice(0, 10).toUpperCase();
      const receipt = {
        mock: true,
        ctrlNo: `MOCK-${hash}`,
        receivedAt: new Date().toISOString(),
        payloadSizeBytes: Buffer.byteLength(JSON.stringify(payload)),
      };
      return {
        ctrlNo: receipt.ctrlNo,
        receipt: JSON.stringify(receipt),
        submittedAt: new Date(),
      };
    }
    return this.submitLive(payload);
  }

  private isMock(): boolean {
    return this.config.get<string>('etims.mode') === 'mock';
  }

  private baseUrl(): string {
    return this.config.get<string>('etims.baseUrl')!;
  }

  private timeoutMs(): number {
    return this.config.getOrThrow<number>('etims.timeoutMs');
  }

  private async acquireToken(): Promise<string> {
    const clientId = this.config.get<string>('etims.clientId') ?? '';
    const clientSecret = this.config.get<string>('etims.clientSecret') ?? '';
    if (!clientId || !clientSecret) {
      throw new Error('ETIMS_CLIENT_ID / ETIMS_CLIENT_SECRET are required in live mode');
    }
    const body = new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      grant_type: 'client_credentials',
    });
    const res = await fetch(`${this.baseUrl()}/v1/auth/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
      signal: AbortSignal.timeout(this.timeoutMs()),
    });
    if (!res.ok) {
      throw new Error(`eTIMS token failed (${res.status}): ${await res.text()}`);
    }
    const json = (await res.json()) as { access_token?: string };
    if (!json.access_token) throw new Error('eTIMS token response missing access_token');
    return json.access_token;
  }

  private async submitLive(payload: Record<string, unknown>): Promise<EtimsReceipt> {
    const token = await this.acquireToken();
    const res = await fetch(`${this.baseUrl()}/v1/etims/invoice`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(this.timeoutMs()),
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`eTIMS submit failed (${res.status}): ${text.slice(0, 500)}`);
    }
    const json = (await res.json()) as {
      ctrlNo?: string;
      data?: { ctrlNo?: string };
    };
    const ctrlNo = json.ctrlNo ?? json.data?.ctrlNo;
    if (!ctrlNo) throw new Error('eTIMS submit succeeded but response has no ctrlNo');
    return { ctrlNo, receipt: JSON.stringify(json), submittedAt: new Date() };
  }
}