import { mkdirSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { config } from '../src/server/config.ts';
import { Store } from '../src/server/store.ts';
import { GeminiBudget } from '../src/server/budget.ts';
import { makeCase } from '../src/server/fixtures.ts';
import { analyzeGemini } from '../src/server/analysis.ts';
const store = new Store(config.geminiBudgetPath), budget = new GeminiBudget(store, config.geminiBudgetUsd);
// Exercise all deferrals first; cached completed cases never trigger another call.
const selectedCase = process.argv.find(x => x.startsWith('--case='))?.slice(7);
if (selectedCase && !['maya','eli','priya','luca','zoe','amara','kai','ren','noah','sam','jules','alex'].includes(selectedCase)) throw new Error('Unknown evaluation case');
const ids = selectedCase ? [selectedCase] : process.argv.includes('--suite') ? ['noah','sam','jules','alex','maya','eli','priya','luca','zoe','amara','kai','ren'] : ['maya'];
const path = process.argv.includes('--retest') ? 'data/gemini-evaluation-retests.json' : 'data/gemini-evaluation.json';
const results: Record<string, unknown> = existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : {};
try {
  for (const id of ids) {
    if (results[id]) { console.log(id + ': previously evaluated; no new call'); continue; }
    const c = makeCase(id);
    try {
      const p = await analyzeGemini(c, 1, { apiKey: config.geminiKey, enabled: config.geminiEnabled, budget });
      const correct = c.ambiguous ? p.decision === 'clarify' : p.decision === 'refund' && p.captureId === c.fixtureTarget;
      results[id] = { at: new Date().toISOString(), correct, proposal: p, evidenceSource: 'authored fixture', paymentExecuted: false };
      mkdirSync('data', { recursive: true }); writeFileSync(path, JSON.stringify(results, null, 2));
      console.log(JSON.stringify({ case: id, decision: p.decision, correct }));
    } catch (error) {
      console.log(JSON.stringify({ case: id, error: error instanceof Error ? error.message : 'Request failed' }));
      process.exitCode = 1; break;
    }
  }
  console.log(JSON.stringify({ budget: budget.snapshot() }));
} finally { store.close(); }
