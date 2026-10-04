import test from 'node:test';
import assert from 'node:assert/strict';
import { Store } from '../src/server/store.ts';
import { ReviewPilot } from '../src/server/review-pilot.ts';

test('pilot conceals answers, reveals cached AI only in assisted trials, and counterbalances assignment', () => {
  const store = new Store(':memory:');
  try {
    const pilot = new ReviewPilot(store), a = pilot.create(true), b = pilot.create(false);
    assert.equal(a.current, undefined); assert.equal(a.results, undefined);
    assert.equal(a.nextMode, 'manual'); assert.equal(b.nextMode, 'assisted');
    const first = pilot.begin(a.id), other = pilot.begin(b.id);
    assert.equal(first.current!.proposal, undefined); assert.equal(other.current!.proposal?.source,'gemini');
    assert.equal(first.current!.evidence.id, other.current!.evidence.id);
    assert.equal(first.current!.evidence.fixtureTarget, undefined); assert.equal(first.current!.evidence.ambiguous, undefined);
  } finally { store.close(); }
});

test('pilot uses durable server timing, rejects stale submissions and foreign receipts, and never writes payments', () => {
  const store = new Store(':memory:'); let time = 1000;
  try {
    const pilot = new ReviewPilot(store,()=>time), run = pilot.create(false);
    assert.throws(()=>pilot.answer(run.id,{index:0,captureId:null,reason:'Unclear intent',interrupted:false}),/no longer active/);
    const started = pilot.begin(run.id); time += 5000;
    assert.equal(new ReviewPilot(store,()=>time).begin(run.id).current!.startedAt,1000);
    assert.throws(()=>pilot.answer(run.id,{index:0,captureId:'foreign',reason:'Wrong receipt',interrupted:false}),/Choose a receipt/);
    const answer={index:0,captureId:started.current!.evidence.purchases[1].id,reason:'Explicitly wants the second payment returned',interrupted:true};
    pilot.answer(run.id,answer);
    assert.throws(()=>pilot.answer(run.id,answer),/no longer active/);
    assert.equal(pilot.view(run.id).results,undefined);
    for(let i=1;i<12;i++) { const trial=pilot.begin(run.id); time+=1000; pilot.answer(run.id,{index:i,captureId:i<8?trial.current!.evidence.purchases[1].id:null,reason:'Automated test data only',interrupted:false}); }
    const final = pilot.view(run.id);
    assert.equal(final.results!.length,12); assert.equal(final.results![0].elapsedMs,5000); assert.equal(final.results![0].interrupted,true);
    assert.equal(final.results!.filter(x=>x.correct).length,12);
    assert.equal(final.results!.filter(x=>x.mode==='manual').length,6);
    assert.equal(final.results!.filter(x=>x.mode==='assisted').length,6);
    assert.equal(store.list('operation').length,0); assert.equal(store.list('case').length,0);
    assert.throws(()=>pilot.begin(run.id),/already complete/);
  } finally { store.close(); }
});

test('pilot preserves wrong and corrected decisions instead of scoring them as successes', () => {
  const store = new Store(':memory:');
  try {
    const pilot=new ReviewPilot(store), run=pilot.create(false);
    for(let i=0;i<12;i++) { pilot.begin(run.id); pilot.answer(run.id,{index:i,captureId:null,reason:'Automated deliberate wrong answer',interrupted:false}); }
    const rows=pilot.view(run.id).results!;
    assert.equal(rows.filter(x=>x.correct).length,4);
    assert.equal(rows.filter(x=>x.changedAI).length,4);
  } finally { store.close(); }
});
