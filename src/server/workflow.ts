import { createHash, randomUUID } from 'node:crypto';
import type { Approval, Capture, Operation, Preview, Proposal, RefundCase, RefundResult } from '../shared/types.ts';
import { Store } from './store.ts';
import { FixturePayments, ProviderRejected, type Payments } from './providers.ts';
import { fixtureProposal } from './fixtures.ts';
import { analyzeGemini } from './analysis.ts';
import { config } from './config.ts';
import type { GeminiBudget } from './budget.ts';
const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
export class Workflow {
  constructor(readonly store: Store, readonly sandbox: Payments, readonly fixture: Payments = new FixturePayments(store), readonly budget?: GeminiBudget) {}
  provider(c: RefundCase) { return c.mode === 'fixture' ? this.fixture : this.sandbox; }
  case(id: string) { return this.store.require<RefundCase>(id); }
  list() { return this.store.list<RefundCase>('case').map(c => { const s = this.status(c.id); return { ...c, resolution: s.operation?.status, decision: s.proposal?.decision, proposalAmount: s.proposal?.amount, refundStatus: s.operation?.provider, refundAmount: s.operation?.preview.amount, updatedAt: s.operation?.updatedAt ?? c.createdAt }; }); }
  async prepare(id: string) {
    const { value: c, revision } = this.case(id);
    const cached = this.store.get<Proposal>(`proposal:${id}`)?.value;
    if (cached?.caseVersion === revision && cached.source === 'gemini') return cached;
    const p = c.mode === 'fixture' ? fixtureProposal(c, revision) : await analyzeGemini(c, revision, { apiKey: config.geminiKey, enabled: config.geminiEnabled, budget: this.budget });
    if (this.case(id).revision !== revision) throw new Error('Case changed while analyzing. Analyze again.');
    this.store.put(`proposal:${id}`, 'proposal', p); this.store.audit('case_prepared', id, { source: p.source, decision: p.decision }); return p;
  }
  manualProposal(id: string, captureId: string, reason: string) {
    const { value: c, revision } = this.case(id), purchase = c.purchases.find(p => p.id === captureId);
    if (!purchase || reason.trim().length < 15) throw new Error('Select a known capture and explain your evidence.');
    const p: Proposal = { decision: 'refund', captureId, amount: purchase.amount, currency: purchase.currency, reason, evidenceIds: c.evidence.map(e => e.id), question: null, source: 'operator', caseVersion: revision };
    this.check(c, p); this.store.put(`proposal:${id}`, 'proposal', p); this.store.audit('operator_proposed', id, { captureId, reason }); return p;
  }
  private check(c: RefundCase, p: Proposal) {
    if (p.decision !== 'refund') throw new Error('Clarification required before a refund preview.');
    if (c.purchases.length !== 2 || new Set(c.purchases.map(x => x.id)).size !== 2 || new Set(c.purchases.map(x => x.orderId)).size !== 2) throw new Error('Exactly two distinct Orders v2 purchases are supported.');
    const purchase = c.purchases.find(x => x.id === p.captureId);
    if (!purchase || purchase.amount !== p.amount || purchase.currency !== p.currency || p.currency !== 'USD' || !Number.isSafeInteger(p.amount) || p.amount! <= 0) throw new Error('Wrong capture, amount or currency.');
    for (const x of c.purchases) if (x.merchantId !== c.merchantId || x.customerId !== c.customerId || x.mode !== c.mode || x.currency !== 'USD' || x.status !== 'COMPLETED') throw new Error('Purchase account, customer, currency or status is invalid.');
    const grant = c.grants.find(g => g.id === purchase.grantId);
    if (!grant || grant.captureId !== purchase.id || grant.customerId !== c.customerId || !grant.active) throw new Error('Refund grant does not match purchase.');
    const retained = c.grants.filter(g => g.id !== grant.id && g.captureId !== purchase.id && g.active && g.customerId === c.customerId && Date.parse(g.expiresAt) > Date.now() && c.purchases.some(x => x.id === g.captureId && x.grantId === g.id));
    if (retained.length !== 1 || c.grants.length !== 2) throw new Error('Independent valid paid access must remain.');
    // Reserve all involved payments: another operation must not refund the retained grant concurrently.
    for (const x of c.purchases) if (this.store.get(`reserved:${c.mode}:${c.merchantId}:${x.id}`)) throw new Error('An operation already reserves a relevant purchase. Review its status.');
    return { purchase, grant, retained };
  }
  private async fresh(c: RefundCase) {
    for (const p of c.purchases) {
      const actual = await this.provider(c).lookup(p);
      for (const key of ['id', 'orderId', 'merchantId', 'customerId', 'amount', 'currency', 'status', 'mode'] as const) if (actual[key] !== p[key]) throw new Error(`Provider ${key} differs from trusted purchase. Refresh evidence before approval.`);
    }
  }
  async preview(id: string) {
    const { value: c, revision } = this.case(id), p = this.store.require<Proposal>(`proposal:${id}`).value;
    if (p.caseVersion !== revision) throw new Error('Analysis is stale. Analyze this case again.');
    const checked = this.check(c, p); await this.fresh(c);
    if (this.case(id).revision !== revision) throw new Error('Case changed during lookup.');
    const base = { id: randomUUID(), caseId: id, caseVersion: revision, merchantId: c.merchantId, captureId: checked.purchase.id, amount: checked.purchase.amount, currency: checked.purchase.currency, revokeGrantId: checked.grant.id, retainedGrantIds: checked.retained.map(g => g.id), createdAt: new Date().toISOString(), proposal: p };
    const preview: Preview = { ...base, fingerprint: hash({ base, case: c }) };
    this.store.insert(`preview:${preview.id}`, 'preview', preview); this.store.put(`latest-preview:${id}`, 'pointer', preview.id); return preview;
  }
  submit(previewId: string) {
    const p = this.store.require<Preview>(`preview:${previewId}`).value;
    if (this.case(p.caseId).revision !== p.caseVersion) throw new Error('Preview is stale.');
    this.store.put(`review:${p.id}`, 'review', { previewId: p.id, requestedAt: new Date().toISOString(), status: 'awaiting_human', owner: 'Local support operator' });
    this.store.audit('review_requested', p.caseId, { previewId: p.id });
    return { status: 'awaiting_human', previewId: p.id, reviewUrl: `http://127.0.0.1:5173/?case=${p.caseId}`, message: 'The operator must approve this exact preview in the application. No refund has been submitted.' };
  }
  async approve(a: Approval, operator: string) {
    if (!operator) throw new Error('Authenticated operator required.');
    const p = this.store.require<Preview>(`preview:${a.id}`).value;
    for (const k of ['id', 'fingerprint', 'merchantId', 'captureId', 'amount', 'currency', 'caseVersion'] as const) if (a[k] !== p[k]) throw new Error('Approval differs from exact preview.');
    const existing = this.store.get<string>(`operation-preview:${p.id}`);
    if (existing) return this.store.require<Operation>(`operation:${existing.value}`).value;
    if (!this.store.get(`review:${p.id}`)) throw new Error('Submit preview for human review first.');
    const { value: c, revision } = this.case(p.caseId);
    if (revision !== p.caseVersion) throw new Error('Stale approval. Generate a new preview.');
    const { fingerprint, ...base } = p;
    if (fingerprint !== hash({ base, case: c })) throw new Error('Approved state fingerprint does not match.');
    const checked = this.check(c, p.proposal); await this.fresh(c);
    const operation = this.store.transaction(() => {
      const raced = this.store.get<string>(`operation-preview:${p.id}`); if (raced) return { existing: this.store.require<Operation>(`operation:${raced.value}`).value };
      if (this.case(c.id).revision !== revision) throw new Error('Case changed before execution.');
      this.check(c, p.proposal);
      const op: Operation = { id: randomUUID(), requestId: randomUUID(), preview: p, approvedBy: operator, approvedAt: new Date().toISOString(), status: 'executing', provider: 'unknown', access: 'unchecked', message: 'Exact approval recorded. Waiting for the payment provider.', updatedAt: new Date().toISOString() };
      for (const x of c.purchases) this.store.insert(`reserved:${c.mode}:${c.merchantId}:${x.id}`, 'reservation', op.id);
      this.store.insert(`operation:${op.id}`, 'operation', op); this.store.insert(`operation-preview:${p.id}`, 'pointer', op.id); this.store.put(`case-operation:${c.id}`, 'pointer', op.id);
      this.store.audit('human_approved', c.id, { operator, preview: p, operationId: op.id, requestId: op.requestId }); return { created: op };
    });
    if (operation.existing) return operation.existing;
    const op = operation.created!;
    try {
      const result = await this.provider(c).refund(checked.purchase, op.requestId, c.scenario);
      this.validateRefund(op, result); op.refundId = result.id; this.save(op);
      // A separate GET verifies the provider outcome; POST acceptance alone is not completion.
      return await this.reconcile(op.id);
    } catch (error) {
      op.status = error instanceof ProviderRejected ? 'rejected' : 'unknown'; op.provider = error instanceof ProviderRejected ? 'not_sent' : 'unknown';
      op.message = error instanceof ProviderRejected ? 'Provider rejected the refund. Keep access and review provider records.' : 'The refund outcome is unknown. The original operation is locked; reconcile it without sending another refund.';
      this.save(op); return op;
    }
  }
  private validateRefund(op: Operation, r: RefundResult) {
    if (r.captureId !== op.preview.captureId || r.amount !== op.preview.amount || r.currency !== op.preview.currency || (op.refundId && op.refundId !== r.id)) throw new Error('Refund readback does not match approved operation.');
  }
  private save(op: Operation) { op.updatedAt = new Date().toISOString(); this.store.put(`operation:${op.id}`, 'operation', op); this.store.audit('operation_status', op.preview.caseId, { operationId: op.id, status: op.status, provider: op.provider, access: op.access }); }
  async reconcile(id: string, attachedRefundId?: string) {
    let op = this.store.require<Operation>(`operation:${id}`).value;
    const c = this.case(op.preview.caseId).value;
    const refundId = op.refundId ?? attachedRefundId;
    if (!refundId) { if (op.status === 'executing') { op.status = 'unknown'; op.message = 'Execution may have been interrupted. No refund identifier is known. Reconcile provider records; do not repeat the refund.'; this.save(op); } return op; }
    try {
      const r = await this.provider(c).readRefund(refundId);
      op = this.store.require<Operation>(`operation:${id}`).value;
      this.validateRefund(op, r);
      // A delayed read must not overwrite a completed financial outcome.
      if (op.provider === 'COMPLETED' && r.status !== 'COMPLETED') return op;
      op.refundId = r.id; op.provider = r.status;
      if (r.status === 'PENDING') { op.status = 'pending'; op.message = 'PayPal has not completed the refund. Access is unchanged; check this same refund again later.'; }
      else if (r.status !== 'COMPLETED') { op.status = 'rejected'; op.message = 'Refund failed or was cancelled. Access remains unchanged. Review provider records.'; }
      else {
        op.status = 'partial'; this.save(op); // Financial completion is durable before touching application access.
        try {
          this.store.transaction(() => {
            const current = this.case(c.id).value;
            if (current.scenario === 'access_failure') throw new Error('Simulated application update failure.');
            const target = current.grants.find(g => g.id === op.preview.revokeGrantId);
            if (!target || target.captureId !== op.preview.captureId) throw new Error('Access relationship changed.');
            if (target.active) { target.active = false; this.store.put(current.id, 'case', current); }
          });
          const feature = this.paidFeature(c.id);
          if (!op.preview.retainedGrantIds.every(g => feature.grantIds.includes(g))) throw new Error('Retained access check failed.');
          op.access = 'retained'; op.status = 'complete'; op.message = 'Full refund verified. The original paid pass still opens Fieldnotes Library.';
        } catch { op.access = 'failed'; op.status = 'partial'; op.message = 'Refund completed, but application access reconciliation failed. Repair access; never repeat the refund.'; }
      }
    } catch {
      const latest = this.store.require<Operation>(`operation:${id}`).value;
      if (latest.provider === 'COMPLETED') return latest;
      op = latest; op.status = 'unknown'; op.message = 'Could not verify the refund against this operation. Keep the original request locked and reconcile provider evidence.';
    }
    this.save(op); return op;
  }
  paidFeature(id: string) {
    const c = this.case(id).value;
    const grantIds = c.grants.filter(g => g.active && g.customerId === c.customerId && Date.parse(g.expiresAt) > Date.now() && c.purchases.some(p => p.id === g.captureId && p.grantId === g.id && p.customerId === c.customerId)).map(g => g.id);
    if (!grantIds.length) throw new Error('No valid paid pass. Library access denied.');
    return { title: 'Fieldnotes Library', customer: c.customer, grantIds, checkedAt: new Date().toISOString(), chapter: 'Designing a better checkout', content: 'A useful checkout makes three things clear: what the customer is buying, what they will pay, and what happens next. Keep the order summary visible. Preserve the receipt when the page reloads. Make every repeated action safe.', mode: c.mode };
  }
  status(id: string) {
    const c = this.case(id), opId = this.store.get<string>(`case-operation:${id}`)?.value, previewId = this.store.get<string>(`latest-preview:${id}`)?.value;
    return { case: c.value, version: c.revision, proposal: this.store.get<Proposal>(`proposal:${id}`)?.value, preview: previewId ? this.store.require<Preview>(`preview:${previewId}`).value : undefined, review: previewId ? this.store.get(`review:${previewId}`)?.value : undefined, operation: opId ? this.store.require<Operation>(`operation:${opId}`).value : undefined };
  }
}
