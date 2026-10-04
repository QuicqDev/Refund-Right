import type { RefundCase, Proposal } from '../shared/types.ts';
import type { Store } from './store.ts';
const requests = [
  ['maya', 'Maya Chen', 'The checkout froze, so I tried again. Please refund the second $29 payment. Keep my original access.'],
  ['eli', 'Eli Brooks', 'I bought the same pass twice this morning. The first one is right; please return the later charge.'],
  ['priya', 'Priya Shah', 'I only need one pass. Undo the payment at 09:46, but leave the 09:42 purchase alone.'],
  ['luca', 'Luca Rivera', 'Two receipts arrived for one access pass. Refund the newer purchase; I still want the library.'],
  ['zoe', 'Zoe Park', 'My first payment worked after all. Can you refund the repeat purchase four minutes later?'],
  ['amara', 'Amara Cole', 'I accidentally checked out again on my phone. Return the second payment, keep the first.'],
  ['kai', 'Kai Morgan', 'Do not cancel my access. I just want the extra, later payment refunded in full.'],
  ['ren', 'Ren Patel', 'Please reverse the newer $29 receipt. I meant to buy just one prepaid pass.'],
  ['noah', 'Noah Williams', 'Something looks wrong with my payments. Can you cancel it?'],
  ['sam', 'Sam Lee', 'Give me half back for the days I did not use.'],
  ['jules', 'Jules Martin', 'Refund the subscription charge from last month.'],
  ['alex', 'Alex Kim', 'I see two receipts. I am not sure which one belongs to me.'],
];
export function makeCase(id = 'maya', scenario: RefundCase['scenario'] = 'completed'): RefundCase {
  const row = requests.find(r => r[0] === id) ?? requests[0];
  const customerId = 'customer-' + id, merchantId = 'fixture-fieldnotes';
  const captures = ['original', 'extra'].map(suffix => 'fixture-' + id + '-' + suffix);
  const expiresAt = new Date(Date.now() + 30 * 86400000).toISOString();
  return { id: 'case-' + id, mode: 'fixture', customerId, merchantId, customer: row[1], email: id + '@example.test', request: row[2], createdAt: new Date().toISOString(), scenario,
    ambiguous: requests.indexOf(row) >= 8, fixtureTarget: captures[1],
    purchases: captures.map((captureId, i) => ({ id: captureId, orderId: 'order-' + captureId, merchantId, customerId, amount: 2900, currency: 'USD', status: 'COMPLETED', mode: 'fixture', label: i ? 'Extra purchase' : 'Original purchase', purchasedAt: '2026-10-04T09:' + (i ? '46' : '42') + ':00Z', grantId: 'grant-' + captureId })),
    grants: captures.map(captureId => ({ id: 'grant-' + captureId, captureId, customerId, active: true, expiresAt })),
    evidence: [{ id: 'request', label: 'Customer message', detail: row[2] }, { id: 'purchase-1', label: 'Original receipt · 09:42', detail: captures[0] + ' funds its own 30-day Fieldnotes Library pass.' }, { id: 'purchase-2', label: 'Second receipt · 09:46', detail: captures[1] + ' funds a separate pass for the same customer.' }, { id: 'access', label: 'Application access ledger', detail: 'Each grant belongs to a specific capture. Refunding one purchase does not revoke other grants.' }],
  };
}
export function fixtureProposal(c: RefundCase, version: number): Proposal {
  return c.ambiguous || !c.fixtureTarget
    ? { decision: 'clarify', captureId: null, amount: null, currency: null, reason: 'The request does not establish a supported full refund of a specific duplicate purchase.', evidenceIds: ['request'], question: 'Which receipt should be refunded in full, and should your original paid access remain active?', source: 'authored_fixture', caseVersion: version }
    : { decision: 'refund', captureId: c.fixtureTarget, amount: 2900, currency: 'USD', reason: 'The customer identifies the later duplicate payment and explicitly keeps the original pass. Each receipt funds a separate access grant.', evidenceIds: ['request', 'purchase-1', 'purchase-2', 'access'], question: null, source: 'authored_fixture', caseVersion: version };
}
export function seed(store: Store) {
  if (store.get('seed-refund-v2')) return;
  store.transaction(() => {
    if (store.get('seed-refund-v2')) return;
    for (const [id] of requests) { const c = makeCase(id); store.insert(c.id, 'case', c); for (const p of c.purchases) store.insert('capture:' + p.id, 'capture', p); }
    for (const scenario of ['pending', 'failed', 'timeout', 'access_failure'] as const) { const c = makeCase(scenario, scenario); c.customer = { pending: 'Taylor James', failed: 'Robin Ellis', timeout: 'Casey Bell', access_failure: 'Drew Avery' }[scenario]; store.insert(c.id, 'case', c); for (const p of c.purchases) store.insert('capture:' + p.id, 'capture', p); }
    store.insert('seed-refund-v2', 'setting', true);
  });
}

