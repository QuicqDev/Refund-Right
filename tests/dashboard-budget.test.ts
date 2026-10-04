import test from 'node:test';
import assert from 'node:assert/strict';
import { summarizeCases, caseStatus, type DashboardCase } from '../src/shared/dashboard.ts';
import { makeCase, fixtureProposal } from '../src/server/fixtures.ts';
import { validateInteraction } from '../src/server/analysis.ts';
import { Store } from '../src/server/store.ts';
import { GeminiBudget, type BudgetCall } from '../src/server/budget.ts';

test('case status describes checkout setup, proposals, clarification and verified resolution consistently', () => {
  assert.equal(caseStatus({...makeCase(), purchases:[]}), 'Checkout setup');
  assert.equal(caseStatus({...makeCase(), decision:'refund'}), 'Proposal ready');
  assert.equal(caseStatus({...makeCase(), decision:'clarify'}), 'Needs clarification');
  assert.equal(caseStatus({...makeCase(), decision:'refund',resolution:'complete'}), 'Resolved');
});

test('new budget reservation size does not release earlier larger reservations', () => {
  const store = new Store(':memory:');
  try {
    store.put('gemini-budget','budget',{capMicros:10_000_000,reservedMicros:2_250_000,authorizedAt:'2026-10-04'});
    const budget = new GeminiBudget(store,10); budget.reserve('case',{},Date.parse('2026-10-04'));
    assert.equal(budget.snapshot().reservedUsd,2.75);
  } finally { store.close(); }
});

test('Gemini proposal tool accepts requires_action but rejects incomplete or unrestricted tool responses', () => {
  const c = makeCase('maya'), { source, caseVersion, ...args } = fixtureProposal(c, 1);
  const step = { type: 'function_call', name: 'propose_resolution', arguments: args };
  assert.equal(validateInteraction({ status: 'requires_action', steps: [step] }, c, 1).captureId, c.fixtureTarget);
  for (const status of ['failed', 'incomplete', 'in_progress', 'budget_exceeded']) assert.throws(() => validateInteraction({ status, steps: [step] }, c, 1));
  for (const steps of [[], [step, step], [{ ...step, name: 'execute_refund' }], [{ ...step, arguments: { ...args, captureId: 'invented' } }]]) assert.throws(() => validateInteraction({ status: 'requires_action', steps }, c, 1));
});

test('dashboard separates sandbox totals and verified refunds from unresolved outcomes', () => {
  const cases: DashboardCase[] = [
    { ...makeCase('maya'), resolution: 'complete', refundStatus: 'COMPLETED', refundAmount: 2900 },
    { ...makeCase('eli'), resolution: 'partial', refundStatus: 'COMPLETED', refundAmount: 2900 },
    { ...makeCase('kai'), resolution: 'unknown', refundStatus: 'unknown', refundAmount: 2900 },
    { ...makeCase('noah'), decision: 'clarify' },
    { ...makeCase('luca'), decision: 'refund', proposalAmount: 2900 },
    { ...makeCase('zoe'), mode: 'sandbox', resolution: 'complete', refundStatus: 'COMPLETED', refundAmount: 2900 },
  ];
  const s = summarizeCases(cases, 'fixture');
  assert.deepEqual([s.total, s.open, s.resolved, s.attention], [5, 4, 1, 3]);
  assert.deepEqual([s.proposedAmount, s.inFlightAmount, s.refundedAmount, s.grossCapturedAmount], [2900, 2900, 5800, 29000]);
  assert.deepEqual([s.partial, s.unknown, s.retainedVerified], [1, 1, 1]);
  assert.equal(summarizeCases(cases, 'sandbox').refundedAmount, 2900);
  assert.equal(summarizeCases([], 'sandbox').total, 0);
});

test('persistent budget reserves failures and blocks spending beyond the authorized cap', () => {
  const store = new Store(':memory:');
  try {
    const budget = new GeminiBudget(store, 10);
    const id = budget.reserve('case', {}, Date.parse('2026-10-04'));
    budget.finish(id, { total_input_tokens: 100, total_output_tokens: 200, total_thought_tokens: 50 });
    budget.finish(id, undefined, true);
    assert.equal(store.require<BudgetCall>('gemini-call:' + id).value.inputTokens, 100);
    const resumed = new GeminiBudget(store, 10);
    for (let i = 1; i < 20; i++) resumed.reserve('case', {}, Date.parse('2026-10-04'));
    assert.equal(resumed.snapshot().reservedUsd, 10);
    assert.throws(() => resumed.reserve('case', {}, Date.parse('2026-10-04')), /cap/);
    assert.equal(resumed.snapshot().calls, 20);
  } finally { store.close(); }
});

test('budget rejects absent authorization, oversized requests and expired pricing before reserving', () => {
  const store = new Store(':memory:');
  try {
    for (const cap of [0, -1, 11, NaN]) assert.throws(() => new GeminiBudget(store, cap).reserve('case', {}), /cap/);
    const budget = new GeminiBudget(store, 10);
    assert.throws(() => budget.reserve('case', 'x'.repeat(64000), Date.parse('2026-10-04')), /size/);
    assert.throws(() => budget.reserve('case', {}, Date.parse('2027-01-01')), /expired/);
    assert.equal(budget.snapshot().calls, 0);
  } finally { store.close(); }
});
