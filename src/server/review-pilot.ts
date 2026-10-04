import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { z } from 'zod';
import { makeCase } from './fixtures.ts';
import { validateProposal } from './analysis.ts';
import type { Store } from './store.ts';
import type { Proposal, RefundCase } from '../shared/types.ts';
import type { PilotResult, PilotView } from '../shared/review-pilot.ts';

type Item = { mode: 'manual' | 'assisted'; evidence: RefundCase; expected: string | null; proposal: Proposal };
type Run = { id: string; familiar: boolean; items: Item[]; answers: PilotResult[]; startedAt?: number };
const groups = [['maya','priya','zoe','kai','noah','sam'], ['eli','luca','amara','ren','alex','jules']];
export const answerSchema = z.object({ index: z.number().int().min(0).max(11), captureId: z.string().nullable(), reason: z.string().trim().min(5).max(1800), interrupted: z.boolean() }).strict();

export class ReviewPilot {
  constructor(private store: Store, private now = () => Date.now()) {}
  create(familiar: boolean): PilotView {
    const cache = JSON.parse(readFileSync(new URL('../../docs/GEMINI_EVALUATION_2026-10-04.json', import.meta.url), 'utf8'));
    return this.store.transaction(() => {
      const counter = this.store.get<number>('pilot-counter')?.value ?? 0;
      const items: Item[] = [];
      // Alternate order and assignment across runs. Each person sees each case once.
      for (let i = 0; i < 6; i++) for (let j = 0; j < 2; j++) {
        const group = (j + counter) % 2, id = groups[group][i], evidence = makeCase(id);
        const expected = evidence.ambiguous ? null : evidence.fixtureTarget!;
        delete evidence.ambiguous; delete evidence.fixtureTarget;
        const { source, caseVersion, ...raw } = (cache.targetedRetests[id] ?? cache.cases[id]).proposal as Proposal;
        const proposal = validateProposal(raw, evidence, 1);
        items.push({ mode: group === counter % 2 ? 'manual' : 'assisted', evidence, expected, proposal });
      }
      // Odd runs start with assisted work, balancing sequence effects separately.
      if (counter % 2) for (let i = 0; i < items.length; i += 2) [items[i], items[i+1]] = [items[i+1], items[i]];
      const run: Run = { id: randomUUID(), familiar, items, answers: [] };
      this.store.insert('pilot:' + run.id, 'review-pilot', run);
      this.store.put('pilot-counter', 'setting', counter + 1);
      return this.view(run.id);
    });
  }
  view(id: string): PilotView {
    const r = this.store.require<Run>('pilot:' + id).value, item = r.items[r.answers.length];
    return { id: r.id, familiar: r.familiar, completed: r.answers.length, total: r.items.length, active: r.startedAt !== undefined,
      ...(item ? { nextMode: item.mode } : { results: r.answers }),
      ...(item && r.startedAt !== undefined ? { current: { evidence: item.evidence, startedAt: r.startedAt, ...(item.mode === 'assisted' ? { proposal: item.proposal } : {}) } } : {}),
    };
  }
  begin(id: string) {
    return this.store.transaction(() => {
      const r = this.store.require<Run>('pilot:' + id).value;
      if (r.answers.length === r.items.length) throw new Error('Review is already complete.');
      if (r.startedAt === undefined) { r.startedAt = this.now(); this.store.put('pilot:' + id, 'review-pilot', r); }
      return this.view(id);
    });
  }
  answer(id: string, raw: unknown) {
    const answer = answerSchema.parse(raw);
    return this.store.transaction(() => {
      const r = this.store.require<Run>('pilot:' + id).value, item = r.items[r.answers.length];
      if (!item || answer.index !== r.answers.length || r.startedAt === undefined) throw new Error('This review is no longer active. Reload the saved run.');
      if (answer.captureId !== null && !item.evidence.purchases.some(p => p.id === answer.captureId)) throw new Error('Choose a receipt in this case.');
      r.answers.push({ ...answer, mode: item.mode, caseId: item.evidence.id, elapsedMs: Math.max(0, this.now() - r.startedAt), correct: answer.captureId === item.expected, expected: item.expected, changedAI: item.mode === 'assisted' && answer.captureId !== item.proposal.captureId });
      delete r.startedAt; this.store.put('pilot:' + id, 'review-pilot', r);
      return this.view(id);
    });
  }
}
