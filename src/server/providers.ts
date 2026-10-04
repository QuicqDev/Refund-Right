import { z } from 'zod';
import type { Capture, RefundCase, RefundResult } from '../shared/types.ts';
import { Store } from './store.ts';
export interface Payments { lookup(capture: Capture): Promise<Capture>; refund(capture: Capture, requestId: string, scenario?: RefundCase['scenario']): Promise<RefundResult>; readRefund(id: string): Promise<RefundResult> }
export class ProviderRejected extends Error {}
export function minor(value: string): number {
  if (!/^(0|[1-9]\d*)\.\d{2}$/.test(value)) throw new Error('Invalid provider money value.');
  const amount = Number(value.replace('.', '')); if (!Number.isSafeInteger(amount)) throw new Error('Money exceeds supported range.'); return amount;
}
const amountSchema = z.object({ value: z.string(), currency_code: z.string() });
const captureSchema = z.object({ id: z.string(), status: z.string(), amount: amountSchema, supplementary_data: z.object({ related_ids: z.object({ order_id: z.string() }) }) });
const refundSchema = z.object({ id: z.string(), status: z.enum(['COMPLETED', 'PENDING', 'FAILED', 'CANCELLED']), amount: amountSchema, links: z.array(z.object({ rel: z.string(), href: z.string() })) });
export class FixturePayments implements Payments {
  calls = 0;
  constructor(private store: Store) {}
  async lookup(c: Capture) { return this.store.require<Capture>(`capture:${c.id}`).value; }
  async refund(c: Capture, requestId: string, scenario?: RefundCase['scenario']): Promise<RefundResult> {
    this.calls++;
    const prior = this.store.get<RefundResult>(`fixture-request:${requestId}`); if (prior) return prior.value;
    const result: RefundResult = { id: `refund-${requestId}`, captureId: c.id, amount: c.amount, currency: c.currency, status: scenario === 'pending' ? 'PENDING' : scenario === 'failed' ? 'FAILED' : 'COMPLETED' };
    this.store.insert(`fixture-request:${requestId}`, 'fixture-refund', result); this.store.insert(`refund:${result.id}`, 'refund', result);
    if (result.status === 'COMPLETED') this.store.put(`capture:${c.id}`, 'capture', { ...c, status: 'REFUNDED' });
    if (scenario === 'timeout') throw new Error('Simulated lost response.');
    return result;
  }
  async readRefund(id: string) { return this.store.require<RefundResult>(`refund:${id}`).value; }
}
export class PayPalSandbox implements Payments {
  private token?: { value: string; expires: number };
  readonly base = 'https://api-m.sandbox.paypal.com';
  constructor(private clientId: string, private secret: string, readonly merchantId: string, private fetcher: typeof fetch = fetch, private webOrigin = 'http://127.0.0.1:5173') {
    if (!['http://127.0.0.1:5173', 'http://127.0.0.1:4331'].includes(webOrigin)) throw new Error('Checkout return origin must be the local Refund Right app.');
  }
  private async oauth() {
    if (!this.clientId || !this.secret || !this.merchantId) throw new Error('Sandbox credentials and PAYPAL_MERCHANT_ID are required.');
    if (this.token && this.token.expires > Date.now()) return this.token.value;
    const r = await this.fetcher(`${this.base}/v1/oauth2/token`, { method: 'POST', headers: { Authorization: `Basic ${Buffer.from(`${this.clientId}:${this.secret}`).toString('base64')}`, 'Content-Type': 'application/x-www-form-urlencoded' }, body: 'grant_type=client_credentials', signal: AbortSignal.timeout(15000) });
    if (!r.ok) throw new Error('PayPal sandbox authentication failed.');
    const t = z.object({ access_token: z.string(), expires_in: z.number().positive() }).parse(await r.json());
    this.token = { value: t.access_token, expires: Date.now() + Math.max(0, t.expires_in - 60) * 1000 }; return t.access_token;
  }
  async request(path: string, method = 'GET', body?: unknown, requestId?: string): Promise<unknown> {
    const token = await this.oauth();
    const r = await this.fetcher(`${this.base}${path}`, { method, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', Prefer: 'return=representation', ...(requestId ? { 'PayPal-Request-Id': requestId } : {}) }, ...(body !== undefined ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(20000) });
    if (!r.ok) { if ([400, 401, 403, 404, 422].includes(r.status)) throw new ProviderRejected(`PayPal sandbox rejected the request (${r.status}).`); throw new Error(`PayPal sandbox outcome unavailable (${r.status}).`); }
    return r.json();
  }
  async order(id: string) { return orderSchema.parse(await this.request(`/v2/checkout/orders/${encodeURIComponent(id)}`)); }
  async lookup(c: Capture): Promise<Capture> {
    const data = captureSchema.parse(await this.request(`/v2/payments/captures/${encodeURIComponent(c.id)}`));
    const order = await this.order(c.orderId), unit = order.purchase_units.find(u => u.payments?.captures?.some(p => p.id === c.id));
    if (!unit || unit.payee?.merchant_id !== this.merchantId || order.payer?.payer_id !== c.customerId || data.supplementary_data.related_ids.order_id !== c.orderId) throw new Error('Provider account, buyer or order relationship mismatch.');
    return { ...c, id: data.id, merchantId: unit.payee.merchant_id, customerId: order.payer.payer_id, status: data.status, amount: minor(data.amount.value), currency: data.amount.currency_code };
  }
  parseRefund(data: unknown): RefundResult {
    const r = refundSchema.parse(data), up = r.links.find(l => l.rel === 'up');
    if (!up) throw new Error('Refund has no capture relationship.');
    const url = new URL(up.href); if (url.protocol !== 'https:' || !['api-m.sandbox.paypal.com', 'api.sandbox.paypal.com'].includes(url.hostname)) throw new Error('Refund relationship is not sandbox.');
    const match = url.pathname.match(/^\/v2\/payments\/captures\/([^/]+)$/); if (!match) throw new Error('Invalid refund capture relationship.');
    return { id: r.id, captureId: match[1], amount: minor(r.amount.value), currency: r.amount.currency_code, status: r.status };
  }
  async refund(c: Capture, requestId: string) { return this.parseRefund(await this.request(`/v2/payments/captures/${encodeURIComponent(c.id)}/refund`, 'POST', { amount: { value: (c.amount / 100).toFixed(2), currency_code: c.currency } }, requestId)); }
  async readRefund(id: string) { return this.parseRefund(await this.request(`/v2/payments/refunds/${encodeURIComponent(id)}`)); }
  async createOrder(caseId: string, slot: number, requestId: string) {
    return orderSchema.parse(await this.request('/v2/checkout/orders', 'POST', { intent: 'CAPTURE', purchase_units: [{ reference_id: `${caseId}:${slot}`, custom_id: `${caseId}:${slot}`, payee: { merchant_id: this.merchantId }, description: 'Fieldnotes Library — prepaid 30-day pass', amount: { value: '29.00', currency_code: 'USD' } }], payment_source: { paypal: { experience_context: { user_action: 'PAY_NOW', shipping_preference: 'NO_SHIPPING', return_url: `${this.webOrigin}/?case=${caseId}&checkout=approved`, cancel_url: `${this.webOrigin}/?case=${caseId}&checkout=cancelled` } } } }, requestId));
  }
  async captureOrder(id: string, requestId: string) { return orderSchema.parse(await this.request(`/v2/checkout/orders/${encodeURIComponent(id)}/capture`, 'POST', {}, requestId)); }
}
export const orderSchema = z.object({ id: z.string(), status: z.string(), payer: z.object({ payer_id: z.string() }).optional(), links: z.array(z.object({ href: z.string(), rel: z.string() })).optional(), purchase_units: z.array(z.object({ custom_id: z.string().optional(), payee: z.object({ merchant_id: z.string() }).optional(), payments: z.object({ captures: z.array(z.object({ id: z.string(), status: z.string(), amount: amountSchema, create_time: z.string().optional() })).optional() }).optional() })).default([]) });
