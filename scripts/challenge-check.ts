import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { config } from '../src/server/config.ts';
import { Store } from '../src/server/store.ts';
import { GeminiBudget } from '../src/server/budget.ts';
import { analyzeGemini } from '../src/server/analysis.ts';
import { challengeCases } from '../src/server/challenge-cases.ts';

const path = 'data/gemini-challenges.json';
const records = existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : {};
const store = new Store(config.geminiBudgetPath), budget = new GeminiBudget(store, config.geminiBudgetUsd);
try {
  for (const item of challengeCases()) {
    if (records[item.id]) continue; // Failed attempts also remain recorded; never retry implicitly.
    try {
      const proposal = await analyzeGemini(item.case, 1, { apiKey: config.geminiKey, enabled: config.geminiEnabled, budget });
      records[item.id] = { at: new Date().toISOString(), expected: item.expected, correct: proposal.decision === item.expected, proposal, evidence: item.case, paymentExecuted: false };
      console.log(JSON.stringify({ case: item.id, correct: records[item.id].correct, decision: proposal.decision }));
    } catch (error) {
      records[item.id] = { at: new Date().toISOString(), expected: item.expected, error: error instanceof Error ? error.message : 'Request failed', paymentExecuted: false };
      console.log(JSON.stringify({ case: item.id, error: records[item.id].error }));
      process.exitCode = 1;
    }
    writeFileSync(path, JSON.stringify(records, null, 2));
    if (process.exitCode) break;
  }
  console.log(JSON.stringify({ budget: budget.snapshot() }));
} finally { store.close(); }
