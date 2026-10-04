import type { Mode, RefundCase } from './types.ts';
export type DashboardCase = RefundCase & { resolution?: string; decision?: string; proposalAmount?: number | null; refundStatus?: string; refundAmount?: number; updatedAt?: string };
export const caseStatus = (c: DashboardCase) => ({ complete: 'Resolved', pending: 'Refund pending', partial: 'Access needs repair', unknown: 'Needs reconciliation', rejected: 'Refund rejected', executing: 'Processing' }[c.resolution ?? ''] ?? (c.decision === 'clarify' || c.ambiguous ? 'Needs clarification' : c.purchases.length < 2 ? 'Checkout setup' : c.decision === 'refund' ? 'Proposal ready' : 'Ready for review'));
export function summarizeCases(cases: DashboardCase[], mode: Mode) {
  const rows = cases.filter(c => c.mode === mode);
  const resolved = rows.filter(c => c.resolution === 'complete').length;
  return {
    total: rows.length, open: rows.length - resolved, resolved,
    attention: rows.filter(c => ['unknown', 'partial', 'rejected'].includes(c.resolution ?? '') || c.decision === 'clarify' || c.ambiguous).length,
    proposedAmount: rows.filter(c => !c.resolution && c.decision === 'refund').reduce((n, c) => n + (c.proposalAmount ?? 0), 0),
    inFlightAmount: rows.filter(c => ['pending', 'executing', 'unknown'].includes(c.resolution ?? '') && c.refundStatus !== 'COMPLETED').reduce((n, c) => n + (c.refundAmount ?? 0), 0),
    refundedAmount: rows.filter(c => c.refundStatus === 'COMPLETED').reduce((n, c) => n + (c.refundAmount ?? 0), 0),
    grossCapturedAmount: rows.reduce((n, c) => n + c.purchases.reduce((sum, p) => sum + p.amount, 0), 0),
    retainedVerified: rows.filter(c => c.resolution === 'complete').length,
    pending: rows.filter(c => c.resolution === 'pending').length,
    unknown: rows.filter(c => ['unknown', 'executing'].includes(c.resolution ?? '')).length,
    partial: rows.filter(c => c.resolution === 'partial').length,
  };
}
