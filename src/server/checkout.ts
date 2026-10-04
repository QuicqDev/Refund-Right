import { randomUUID } from 'node:crypto';
import { PayPalSandbox, minor } from './providers.ts';
import { Store } from './store.ts';
import type { RefundCase } from '../shared/types.ts';
type Checkout = { caseId: string; slot: number; requestId: string; captureRequestId: string; orderId?: string; approvalUrl?: string; status: string; captureAttempted?: boolean };
export class CheckoutService {
  constructor(private store: Store, private paypal: PayPalSandbox) {}
  createCase(customer: string, request: string) {
    const c: RefundCase = { id: 'sandbox-' + randomUUID(), mode: 'sandbox', merchantId: this.paypal.merchantId, customerId: '', customer, email: 'sandbox buyer', request, purchases: [], grants: [], evidence: [{ id: 'request', label: 'Customer message', detail: request }], createdAt: new Date().toISOString() };
    if (!c.merchantId) throw new Error('Configure PAYPAL_MERCHANT_ID before creating a sandbox case.');
    this.store.insert(c.id, 'case', c); return c;
  }
  async create(caseId: string) {
    const c = this.store.require<RefundCase>(caseId).value;
    if (c.mode !== 'sandbox' || c.purchases.length >= 2) throw new Error('Setup supports two sandbox purchases only.');
    const slot = c.purchases.length, key = `checkout:${caseId}:${slot}`;
    const existing = this.store.get<Checkout>(key); if (existing) return existing.value;
    const checkout: Checkout = { caseId, slot, requestId: randomUUID(), captureRequestId: randomUUID(), status: 'creating' };
    this.store.insert(key, 'checkout', checkout);
    try {
      const order = await this.paypal.createOrder(caseId, slot, checkout.requestId);
      checkout.orderId = order.id; const url = order.links?.find(x => ['payer-action', 'approve'].includes(x.rel))?.href;
      if (!url || new URL(url).hostname !== 'www.sandbox.paypal.com' || new URL(url).protocol !== 'https:') throw new Error('Missing trusted sandbox approval link.');
      checkout.approvalUrl = url; checkout.status = 'awaiting_buyer';
    } catch { checkout.status = 'unknown'; }
    this.store.put(key, 'checkout', checkout); return checkout;
  }
  async capture(caseId: string, slot: number) {
    const key = `checkout:${caseId}:${slot}`;
    let checkout = this.store.require<Checkout>(key).value;
    if (!checkout.orderId) throw new Error('No known order. Reconcile order creation before continuing.');
    let order = await this.paypal.order(checkout.orderId);
    if (order.status !== 'COMPLETED') {
      if (order.status !== 'APPROVED') throw new Error('The buyer must approve this purchase in PayPal sandbox first.');
      this.store.transaction(() => {
        checkout = this.store.require<Checkout>(key).value;
        if (checkout.captureAttempted) throw new Error('Capture was already attempted. Only order readback is allowed; reconcile an unknown result.');
        checkout.captureAttempted = true; checkout.status = 'capturing'; this.store.put(key, 'checkout', checkout);
      });
      try { order = await this.paypal.captureOrder(checkout.orderId!, checkout.captureRequestId); }
      catch { checkout.status = 'unknown'; this.store.put(key, 'checkout', checkout); throw new Error('Capture outcome unknown. Check this order again; no new capture will be sent.'); }
    }
    return this.store.transaction(() => {
      const c = this.store.require<RefundCase>(caseId).value;
      if (c.purchases.some(p => p.orderId === order.id)) return c;
      const unit = order.purchase_units[0], payment = unit?.payments?.captures?.[0], buyer = order.payer?.payer_id;
      if (order.status !== 'COMPLETED' || order.purchase_units.length !== 1 || unit?.payments?.captures?.length !== 1 || unit.custom_id !== `${caseId}:${slot}` || unit.payee?.merchant_id !== c.merchantId || !buyer || (c.customerId && c.customerId !== buyer) || !payment || payment.status !== 'COMPLETED' || minor(payment.amount.value) !== 2900 || payment.amount.currency_code !== 'USD') throw new Error('Order, merchant, buyer or payment does not match the reference checkout.');
      c.customerId = buyer;
      const grantId = 'grant-' + payment.id;
      c.purchases.push({ id: payment.id, orderId: order.id, merchantId: c.merchantId, customerId: buyer, amount: 2900, currency: 'USD', status: payment.status, mode: 'sandbox', label: slot ? 'Extra purchase' : 'Original purchase', purchasedAt: payment.create_time ?? new Date().toISOString(), grantId });
      c.grants.push({ id: grantId, captureId: payment.id, customerId: buyer, active: true, expiresAt: new Date(Date.now() + 30 * 86400000).toISOString() });
      c.evidence.push({ id: `purchase-${slot + 1}`, label: `PayPal sandbox receipt ${slot + 1}`, detail: `Order ${order.id}, capture ${payment.id}, merchant ${c.merchantId}; funds ${grantId}.` });
      if (c.purchases.length === 2) c.evidence.push({ id: 'access', label: 'Reference app access ledger', detail: 'Two independent prepaid access grants, each funded by one capture.' });
      this.store.put(c.id, 'case', c); checkout.status = 'captured'; this.store.put(key, 'checkout', checkout); return c;
    });
  }
  list(caseId: string) { return this.store.list<Checkout>('checkout').filter(x => x.caseId === caseId); }
}
