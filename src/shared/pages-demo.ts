import type { Proposal, RefundCase } from './types';

// Browser-only simulation. This module has no payment client or server access.
export function simulateRefund(c: RefundCase, p: Proposal): RefundCase {
  if(c.mode !== 'fixture' || p.decision !== 'refund') throw new Error('Only an explicit fixture refund can be simulated.');
  const receipt = c.purchases.find(x=>x.id === p.captureId);
  if (!receipt || receipt.amount !== p.amount || receipt.currency !== p.currency) throw new Error('The proposal must match a receipt.');
  const target = c.grants.find(g=>g.id===receipt.grantId && g.captureId===receipt.id && g.active);
  const keep = c.grants.filter(g=>g.id!==target?.id && g.active && Date.parse(g.expiresAt)>Date.now() && c.purchases.some(x=>x.id===g.captureId && x.grantId===g.id));
  if(!target || keep.length !== 1) throw new Error('A separate active paid pass must remain.');
  return {...c, grants:c.grants.map(g=>g.id===target.id ? {...g,active:false} : {...g})};
}
