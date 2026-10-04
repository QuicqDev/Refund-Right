import test from 'node:test';
import assert from 'node:assert/strict';
import { makeCase, fixtureProposal } from '../src/server/fixtures.ts';
import { simulateRefund } from '../src/shared/pages-demo.ts';

test('Pages simulation revokes only the selected pass and rejects replay or ambiguity',()=>{
  const c=makeCase(),p=fixtureProposal(c,1),next=simulateRefund(c,p);
  assert.equal(c.grants[1].active,true);
  assert.equal(next.grants[0].active,true);assert.equal(next.grants[1].active,false);
  assert.throws(()=>simulateRefund(next,p),/separate active/);
  assert.throws(()=>simulateRefund(makeCase('noah'),fixtureProposal(makeCase('noah'),1)),/explicit fixture/);
});
test('Pages simulation refuses sandbox data, changed amounts and loss of independently paid access',()=>{
  const c=makeCase(),p=fixtureProposal(c,1);
  assert.throws(()=>simulateRefund({...c,mode:'sandbox'},p),/explicit fixture/);
  assert.throws(()=>simulateRefund(c,{...p,amount:1}),/match a receipt/);
  c.grants[0].active=false;assert.throws(()=>simulateRefund(c,p),/separate active/);
});
