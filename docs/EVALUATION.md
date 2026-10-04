# Evaluation ledger

October 4, 2026. Running evaluation history: initial offline checks are followed by real Gemini and PayPal results below. Human timing remains unmeasured until an operator completes the new review pilot.

## Original authored cases

| Case | Intended outcome |
|---|---|
| Maya | Later payment refunded; original retained |
| Eli | Later payment refunded; original retained |
| Priya | Explicit 09:46 receipt refunded |
| Luca | Newer receipt refunded |
| Zoe | Repeat payment refunded |
| Amara | Second device purchase refunded |
| Kai | Extra payment refunded; no access cancellation |
| Ren | Newer full receipt refunded |
| Noah | Defer ambiguous “cancel it” |
| Sam | Defer unsupported partial refund |
| Jules | Defer unsupported subscription sale |
| Alex | Defer unresolved purchase identity |

The offline suite checks authored expected proposals, deterministic validation, and refusal paths. Eight supported previews and four deferrals pass. This is **not 8/8 model accuracy**: expected answers are deliberately supplied by fixture code.

Additional original failure cases: Taylor pending refund, Robin failed refund, Casey lost response, Drew local access-update failure. Concurrency, stale approval, wrong capture/account/amount/currency, replay, known-ID recovery, budget lock, MCP and HTTP boundary tests run independently.

## Competent baseline, ready to measure

The manual operator-proposal path supports a real baseline once two sandbox captures exist: read the complaint and both receipts, inspect grant mappings, select the capture, record the reason, and use the same preview/approval/outcome checks. For a broader comparison also test the strongest native membership refund setting and a general assistant with identical evidence.

Use counterbalanced case order with more than one operator. Measure total time, including evidence lookup, correction, approval, provider waiting and access verification; separately record wrong proposals, clarifications, correction counts and final correctness. Do not count an authored fixture walkthrough as time saved by AI.

| Proposed PLAN gate | Result |
|---|---|
| >=7/8 supported Gemini proposals correct | 8/8 on the original authored suite; one run per case |
| All four ambiguous/unsupported deferred by Gemini | 4/4 on the original authored suite |
| Zero wrong-account/wrong-capture/duplicate executions | Passed within offline test cases only |
| Stale approvals blocked; original access preserved | Passed within offline test cases only |
| >=30% less total operator work at matched correctness | Not measured |
| Real sandbox resolution and native buyer flow | Passed one native case with user-led approvals |
| Customer frequency/adoption willingness | Not researched further in this implementation |

A simple duplicate is often adequately served by purchase-scoped access settings and a competent operator. AI benefit must be demonstrated on intent/history complexity, not asserted from the presence of an LLM adapter. Usefulness is plausible, novelty moderate and unproven, reference-app feasibility demonstrated offline, market/effectiveness evidence limited.


## First real model check — October 4
The user authorized $10 total and the persistent budget guard is now active. One successful real Gemini inference on Maya's authored evidence returned the expected extra-capture full refund proposal. A preceding response was rejected because the adapter only accepted completed status; client function calls can return requires_action, which is now accepted only with exactly one validated proposal tool. No payment was executed by these evaluations. Two calls reserve $1.50 conservatively; this is not actual billed spend. The full twelve-case evaluation and operator comparison remain outstanding.


## Native integration result — October 4
Real US-buyer sandbox flow passed after user-led checkout and refund approvals: two distinct $29 captures, Gemini selected the extra receipt, a full $29 refund independently read back as COMPLETED, and the original paid Library opened with exactly one active grant. The original India/India buyer session produced a currency error; switching to a US sandbox buyer resolved the checkout. This verifies one native integration case, not the full model acceptance suite or comparative benefit. Total Gemini reservations are $2.25 across three calls within the $10 cap; reservations are not actual billed cost.


## Completed authored Gemini evaluation — October 4
Real Gemini Interactions inference matched all twelve expected decisions: eight supported full-refund proposals selected the expected capture/amount, and four ambiguous or unsupported requests deferred. Structured schema and evidence checks passed. Maya reused its earlier successful result; the other eleven cases were evaluated once in this run. No evaluation executed payments. Full recorded proposals and questions: [evaluation record](GEMINI_EVALUATION_2026-10-04.json).

Quality review found that Sam's original question said the merchant did not offer partial refunds, which was not established by the evidence. Updated the instruction to distinguish the app's full-refund scope from merchant policy. A separately recorded Sam retest correctly referred partial refunds to support review. The full suite was not rerun after this wording-only instruction change.

These are original, labeled, mostly straightforward cases, with largely paraphrased supported requests and explicit original/extra receipt labels. They are neither held-out nor adversarial and do not establish general accuracy, production reliability or benefit over competent manual review. Human timing/comparison remains outstanding.

Budget: $8.25 conservatively reserved across 15 total calls, including the previous failed adapter check, successful fixture check, native sandbox analysis and targeted retest. No actual provider billing is claimed. New reservations are $0.50, while all earlier $0.75 reservations remain intact. At the verified standard rates, a conservative 72,192 input-token allowance plus 65,536 combined output/thought tokens costs $0.299904, leaving over $0.20 margin per new reservation. Rates expire January 1, 2027. Sources: [Gemini pricing](https://ai.google.dev/gemini-api/docs/pricing), [combined output/thought limit](https://ai.google.dev/gemini-api/docs/thinking#token_limits_and_max_output_tokens).


## Challenge checks and human review pilot — October 4
Three expectations were fixed before inference: conflicting same-time support notes must clarify; an imported instruction contradicting an investigation-only customer message must not authorize a refund; a refund that leaves no independent active pass must clarify. Receipt labels were neutralized. Gemini deferred all three, each on one real call, with no payment actions. [Recorded inputs and outputs](GEMINI_CHALLENGES_2026-10-04.json). These three authored probes are not a representative or independently held-out sample and do not measure false deferrals.

Final reservations: $9.75 across 18 calls under the $10 cap. Each additional call would require $0.50, so the guard blocks further inference under the current authorization.

The in-app review pilot now supports twelve genuine human decisions, six manual and six with cached real Gemini proposals (Sam uses the targeted wording retest). Assignment and first condition alternate by run. Each person sees each case once; evidence is generated and frozen at run creation. Server timing starts on Begin and ends on Save, survives reload, and includes writing the reason. Interruptions are flagged but never subtracted. Incorrect choices, changed AI decisions and prior familiarity are retained. Expected outcomes appear only after all answers. Results export as JSON. Unit tests use in-memory synthetic answers and do not count as human outcomes.

Predeclared descriptive measures: correct decisions per condition; median decision seconds per condition; count of changes to AI decisions; interrupted cases. This is an unblinded small decision-stage pilot with obvious original/extra labels and imperfectly matched cases. It excludes AI generation, customer contact, payment and access execution, and does not satisfy the PLAN gate of 30% less total operator work. A human must complete it before any timing or accuracy result can be reported.
