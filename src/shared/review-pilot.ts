import type { Proposal, RefundCase } from './types';
export type ReviewAnswer = { index: number; captureId: string | null; reason: string; interrupted: boolean };
export type PilotResult = ReviewAnswer & { mode: 'manual' | 'assisted'; caseId: string; elapsedMs: number; correct: boolean; changedAI: boolean; expected: string | null };
export type PilotView = {
  id: string; familiar: boolean; completed: number; total: number; active: boolean;
  nextMode?: 'manual' | 'assisted';
  current?: { evidence: RefundCase; proposal?: Proposal; startedAt: number };
  results?: PilotResult[];
};
