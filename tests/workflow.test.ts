import test from 'node:test';
import assert from 'node:assert/strict';
import { Store } from '../src/server/store.ts';
import { seed, fixtureProposal } from '../src/server/fixtures.ts';
import { FixturePayments, ProviderRejected } from '../src/server/providers.ts';
import { Workflow } from '../src/server/workflow.ts';
import { analyzeGemini, validateProposal } from '../src/server/analysis.ts';
import type { Approval, Capture, Operation, Preview, RefundCase, RefundResult } from '../src/shared/types.ts';
const setup = () => { const store = new Store(':memory:'); seed(store); const provider = new FixturePayments(store); return { store, provider, flow: new Workflow(store, provider, provider) }; };
async function reviewed(flow: Workflow, id = 'case-maya') { await flow.prepare(id); const p = await flow.preview(id); flow.submit(p.id); return p; }
function approval(p: Preview): Approval { return { id: p.id, fingerprint: p.fingerprint, merchantId: p.merchantId, captureId: p.captureId, amount: p.amount, currency: p.currency, caseVersion: p.caseVersion }; }
test('full refund preserves independently funded paid feature and separate refund readback', async () => {
  const { flow, provider, store } = setup();
  try { const p = await reviewed(flow); const op = await flow.approve(approval(p), 'operator'); assert.equal(op.status, 'complete'); assert.equal(op.provider, 'COMPLETED'); assert.equal(op.access, 'retained'); assert.deepEqual(flow.paidFeature('case-maya').grantIds, p.retainedGrantIds); assert.equal(flow.case('case-maya').value.grants.find(g => g.id === p.revokeGrantId)?.active, false); assert.equal(provider.calls, 1); } finally { store.close(); }
});
test('twelve authored evaluation cases: eight supported previews, four deferred; no claim of AI performance', async () => {
  const { flow, store } = setup();
  try { for (const id of ['maya', 'eli', 'priya', 'luca', 'zoe', 'amara', 'kai', 'ren']) { const p = await flow.prepare('case-' + id); assert.equal(p.source, 'authored_fixture'); assert.equal((await flow.preview('case-' + id)).captureId, 'fixture-' + id + '-extra'); } for (const id of ['noah', 'sam', 'jules', 'alex']) { assert.equal((await flow.prepare('case-' + id)).decision, 'clarify'); await assert.rejects(flow.preview('case-' + id), /Clarification/); } } finally { store.close(); }
});
test('wrong capture/account/amount/currency/version approval is rejected without payment', async () => {
  const { flow, store, provider } = setup();
  try { const p = await reviewed(flow); for (const change of [{ captureId: 'other' }, { merchantId: 'other' }, { amount: 1 }, { currency: 'EUR' }, { caseVersion: 99 }, { fingerprint: 'fake' }]) await assert.rejects(flow.approve({ ...approval(p), ...change }, 'operator'), /Approval differs/); assert.equal(provider.calls, 0); } finally { store.close(); }
});
test('stale approval from changed entitlement state is rejected', async () => {
  const { flow, store, provider } = setup();
  try { const p = await reviewed(flow); const c = flow.case(p.caseId).value; c.grants[0].active = false; store.put(c.id, 'case', c); await assert.rejects(flow.approve(approval(p), 'operator'), /Stale/); assert.equal(provider.calls, 0); } finally { store.close(); }
});
test('provider wrong identity, account, amount, currency and refunded capture are blocked', async () => {
  for (const change of [{ id: 'other' }, { orderId: 'other' }, { customerId: 'other' }, { merchantId: 'other' }, { amount: 2800 }, { currency: 'EUR' }, { status: 'REFUNDED' }]) {
    const { flow, store, provider } = setup(); try { const p = await reviewed(flow); const c = store.require<Capture>('capture:' + p.captureId).value; store.put('capture:' + p.captureId, 'capture', { ...c, ...change }); await assert.rejects(flow.approve(approval(p), 'operator'), /Provider/); assert.equal(provider.calls, 0); } finally { store.close(); }
  }
});
test('repeated and concurrent approval uses one durable operation and one request', async () => {
  const { flow, store, provider } = setup(); try { const p = await reviewed(flow); const outcomes = await Promise.all(Array.from({ length: 6 }, () => flow.approve(approval(p), 'operator'))); assert.equal(new Set(outcomes.map(x => x.id)).size, 1); assert.equal(provider.calls, 1); assert.equal((await flow.approve(approval(p), 'operator')).status, 'complete'); assert.equal(provider.calls, 1); } finally { store.close(); }
});
test('competing previews and independent Workflow instances cannot refund the same payment twice', async () => {
  const { flow, store, provider } = setup(); try { const a = await reviewed(flow), b = await flow.preview(a.caseId); flow.submit(b.id); const second = new Workflow(store, provider, provider); const outcomes = await Promise.allSettled([flow.approve(approval(a), 'one'), second.approve(approval(b), 'two')]); assert.equal(outcomes.filter(x => x.status === 'fulfilled').length, 1); assert.equal(provider.calls, 1); } finally { store.close(); }
});
test('approval requires a human review record and operator identity', async () => {
  const { flow, store } = setup(); try { await flow.prepare('case-maya'); const p = await flow.preview('case-maya'); await assert.rejects(flow.approve(approval(p), 'operator'), /human review/); flow.submit(p.id); await assert.rejects(flow.approve(approval(p), ''), /operator/); } finally { store.close(); }
});
for (const [scenario, status, providerStatus] of [['pending', 'pending', 'PENDING'], ['failed', 'rejected', 'FAILED'], ['timeout', 'unknown', 'unknown'], ['access_failure', 'partial', 'COMPLETED']] as const) {
  test(`${scenario}: independent honest outcomes, replay never creates a second refund`, async () => {
    const { flow, store, provider } = setup(); try { const p = await reviewed(flow, 'case-' + scenario); const op = await flow.approve(approval(p), 'operator'); assert.equal(op.status, status); assert.equal(op.provider, providerStatus); assert.equal(flow.case(p.caseId).value.grants[0].active, true); await flow.approve(approval(p), 'operator'); await flow.reconcile(op.id); assert.equal(provider.calls, 1); if (scenario === 'timeout') { const r = store.require<RefundResult>('fixture-request:' + op.requestId).value; const recovered = await flow.reconcile(op.id, r.id); assert.equal(recovered.status, 'complete'); assert.equal(provider.calls, 1); } } finally { store.close(); }
  });
}
test('pending progresses through readback; failed access repair does not resend payment', async () => {
  const { flow, store, provider } = setup(); try { const p = await reviewed(flow, 'case-pending'); const op = await flow.approve(approval(p), 'operator'); const r = store.require<RefundResult>('refund:' + op.refundId).value; store.put('refund:' + r.id, 'refund', { ...r, status: 'COMPLETED' }); assert.equal((await flow.reconcile(op.id)).status, 'complete'); const other = await reviewed(flow, 'case-access_failure'); const failed = await flow.approve(approval(other), 'operator'); const c = flow.case(other.caseId).value; c.scenario = 'completed'; store.put(c.id, 'case', c); assert.equal((await flow.reconcile(failed.id)).status, 'complete'); assert.equal(provider.calls, 2); } finally { store.close(); }
});
test('unknown operation refuses unrelated refund evidence', async () => {
  const { flow, store, provider } = setup(); try { const p = await reviewed(flow, 'case-timeout'); const op = await flow.approve(approval(p), 'operator'); store.insert('refund:unrelated', 'refund', { id: 'unrelated', captureId: 'wrong', amount: 2900, currency: 'USD', status: 'COMPLETED' }); const checked = await flow.reconcile(op.id, 'unrelated'); assert.equal(checked.status, 'unknown'); assert.equal(checked.refundId, undefined); assert.equal(provider.calls, 1); } finally { store.close(); }
});
test('restart-style recovery of interrupted operation never resubmits a payment', async () => {
  const { flow, store, provider } = setup(); try { const p = await reviewed(flow, 'case-timeout'); const op = await flow.approve(approval(p), 'operator'); store.put('operation:' + op.id, 'operation', { ...op, status: 'executing' } satisfies Operation); const restarted = new Workflow(store, provider, provider); assert.equal((await restarted.reconcile(op.id)).status, 'unknown'); assert.equal(provider.calls, 1); } finally { store.close(); }
});
test('provider rejection is distinct from timeout', async () => {
  const { flow, store, provider } = setup(); try { provider.refund = async () => { throw new ProviderRejected('Rejected'); }; const p = await reviewed(flow); const op = await flow.approve(approval(p), 'operator'); assert.equal(op.status, 'rejected'); assert.equal(op.provider, 'not_sent'); } finally { store.close(); }
});
test('budget lock prevents Gemini call and structured proposals reject invented evidence/actions', async () => {
  const { flow, store } = setup(); try { const c = flow.case('case-maya').value; await assert.rejects(analyzeGemini(c, 1, { apiKey: 'unused', enabled: false }), /disabled/); const { source, caseVersion, ...p } = fixtureProposal(c, 1); assert.equal(validateProposal(p, c, 1).source, 'gemini'); for (const change of [{ captureId: 'invented' }, { amount: 1 }, { currency: 'EUR' }, { evidenceIds: ['fake'] }, { approved: true }, { decision: 'clarify', question: 'which?' }]) assert.throws(() => validateProposal({ ...p, ...change }, c, 1)); } finally { store.close(); }
});
test('expired, mismatched and absent independent grants cannot be approved', async () => {
  for (const field of ['expired', 'wrong', 'inactive']) { const { flow, store } = setup(); try { const c = flow.case('case-maya').value; if (field === 'expired') c.grants[0].expiresAt = '2020-01-01T00:00:00Z'; if (field === 'wrong') c.grants[1].captureId = c.purchases[0].id; if (field === 'inactive') c.grants[0].active = false; store.put(c.id, 'case', c); await flow.prepare(c.id); await assert.rejects(flow.preview(c.id)); } finally { store.close(); } }
});
test('manual baseline is attributed to the operator and obeys the same validation', async () => {
  const { flow, store, provider } = setup(); try { const c = flow.case('case-maya').value; const p = flow.manualProposal(c.id, c.purchases[1].id, 'Reviewed both receipts and the explicit request for the second full refund.'); assert.equal(p.source, 'operator'); const preview = await flow.preview(c.id); flow.submit(preview.id); assert.equal((await flow.approve(approval(preview), 'operator')).status, 'complete'); assert.equal(provider.calls, 1); } finally { store.close(); }
});
test('late pending readback cannot regress a concurrently completed refund', async () => {
  const { flow, store, provider } = setup(); try {
    const p = await reviewed(flow, 'case-pending'), op = await flow.approve(approval(p), 'operator');
    const r = store.require<RefundResult>('refund:' + op.refundId).value;
    let release!: (value: RefundResult) => void, calls = 0;
    provider.readRefund = async () => { if (++calls === 1) return new Promise<RefundResult>(resolve => { release = resolve; }); return { ...r, status: 'COMPLETED' }; };
    const late = flow.reconcile(op.id); assert.equal((await flow.reconcile(op.id)).status, 'complete'); release(r); assert.equal((await late).status, 'complete'); assert.equal(flow.status(p.caseId).operation?.provider, 'COMPLETED');
  } finally { store.close(); }
});
