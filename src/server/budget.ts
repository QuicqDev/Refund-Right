import { randomUUID } from 'node:crypto';
import { Store } from './store.ts';

const MICROS = 1_000_000;
export const RESERVATION_MICROS = 500_000;
export type BudgetCall = { id: string; caseId: string; reservedMicros: number; at: string; state: 'reserved' | 'completed' | 'failed'; inputTokens?: number; outputTokens?: number; thoughtTokens?: number; estimatedCostMicros?: number };
type Ledger = { capMicros: number; reservedMicros: number; authorizedAt: string };

/** A separate, fixed database shares the cap across UI, MCP, evaluations and case databases.
 * Keep reservations after failures: response loss does not prove zero provider billing.
 * $0.50 covers 64 KB text (at most one token per UTF-8 byte plus 8,192 overhead)
 * and 65,536 combined output/thought tokens: 72,192 * $0.75/M +
 * 65,536 * $3.75/M = $0.299904; retain >$0.20 margin. Text only, no paid tools.
 * Prior $0.75 reservations remain intact. Rates: ai.google.dev/gemini-api/docs/pricing.
 * Rates are checked against Google's standard pricing, and expire on 2026-12-31. */
export class GeminiBudget {
  constructor(readonly store: Store, private authorizedUsd: number) {}
  snapshot() {
    const ledger = this.store.get<Ledger>('gemini-budget')?.value;
    return { capUsd: ledger ? Math.min(ledger.capMicros / MICROS, this.authorizedUsd) : this.authorizedUsd, reservedUsd: (ledger?.reservedMicros ?? 0) / MICROS, reservationPerCallUsd: RESERVATION_MICROS / MICROS, calls: this.store.list<BudgetCall>('gemini-call').length };
  }
  reserve(caseId: string, request: unknown, now = Date.now()) {
    if (!Number.isFinite(this.authorizedUsd) || this.authorizedUsd <= 0 || this.authorizedUsd > 10) throw new Error('An authorized Gemini cap of up to $10 is required.');
    if (now >= Date.parse('2027-01-01T00:00:00Z')) throw new Error('Gemini pricing guard expired. Verify rates before making another call.');
    if (Buffer.byteLength(JSON.stringify(request), 'utf8') > 64_000) throw new Error('Case exceeds the bounded Gemini request size.');
    return this.store.transaction(() => {
      const ledger = this.store.get<Ledger>('gemini-budget')?.value ?? { capMicros: Math.floor(this.authorizedUsd * MICROS), reservedMicros: 0, authorizedAt: new Date(now).toISOString() };
      const cap = Math.min(ledger.capMicros, Math.floor(this.authorizedUsd * MICROS));
      if (ledger.reservedMicros + RESERVATION_MICROS > cap) throw new Error('Gemini budget guard reached the authorized cap. No request was sent.');
      ledger.reservedMicros += RESERVATION_MICROS;
      this.store.put('gemini-budget', 'budget', ledger);
      const call: BudgetCall = { id: randomUUID(), caseId, reservedMicros: RESERVATION_MICROS, at: new Date(now).toISOString(), state: 'reserved' };
      this.store.insert('gemini-call:' + call.id, 'gemini-call', call); return call.id;
    });
  }
  finish(id: string, usage?: { total_input_tokens?: number; total_output_tokens?: number; total_thought_tokens?: number }, failed = false) {
    const call = this.store.require<BudgetCall>('gemini-call:' + id).value;
    const safe = (n?: number) => Number.isSafeInteger(n) && n! >= 0 ? n : undefined;
    call.state = failed ? 'failed' : 'completed';
    if (usage) { call.inputTokens = safe(usage.total_input_tokens); call.outputTokens = safe(usage.total_output_tokens); call.thoughtTokens = safe(usage.total_thought_tokens); }
    if (call.inputTokens !== undefined && call.outputTokens !== undefined && call.thoughtTokens !== undefined) call.estimatedCostMicros = Math.ceil(call.inputTokens * 0.75 + (call.outputTokens + call.thoughtTokens) * 3.75);
    this.store.put('gemini-call:' + id, 'gemini-call', call);
  }
}
