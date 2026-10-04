# Refund Right

**Refund the extra payment without removing access the customer already paid for.**

A local support workspace for Fieldnotes Library, an original prepaid digital-access reference app. Review a customer complaint, follow two purchases to their individual access grants, approve one exact full refund, and independently open the retained paid feature.

## Browser showcase

Source is on `main`; the prepared static site is on `gh-pages`. The repository remains private. GitHub Free cannot serve Pages from a private organization repository, so site activation awaits the owner’s planned public release.

A separate credential-free GitHub Pages build provides an interactive sample dashboard, recorded AI proposals, simulated refund approval and retained-access checks. It makes no PayPal or Gemini requests. Build with `npm run build:pages`; preview with `npm run preview:pages` at `http://127.0.0.1:4173/Refund-Right/`. See [GitHub Pages setup](docs/GITHUB_PAGES.md). The full server application below remains the actual integration implementation.

## Run independently

Requires Node.js 22.14+ and npm. This repository owns all source, dependencies and SQLite data; no parent or sibling imports.

```powershell
git clone https://github.com/QuicqDev/Refund-Right.git
Set-Location Refund-Right
npm ci
npm run dev
```

Open http://127.0.0.1:5173. API: http://127.0.0.1:4331. Both bind to loopback. No credentials are required for the **offline fixture demo**. If an operator password is configured, sign in with it. Existing ignored `.env` values are preserved; on a fresh clone, copy `.env.example` to `.env`.

```powershell
npm run typecheck
npm test
npm run build
npm start
```

After a build, `npm start` also serves the compiled UI at port 4331. For sandbox checkout returns in this production-preview mode, set `REFUND_RIGHT_WEB_ORIGIN=http://127.0.0.1:4331`. Default development return origin is port 5173.

Operator sign-in lasts up to eight hours and survives reloads and local app restarts. Sign out revokes the session; a password change also invalidates existing sessions. Cookies stay HttpOnly and SameSite=Strict; write actions still require CSRF protection.

Data persists in `data/refund-right.sqlite`. To start a separate clean demonstration, stop the app and set `REFUND_RIGHT_DB=data/demo-2.sqlite` before restarting. Preserve old databases and operation receipts. Never reset a database containing unresolved sandbox operations.

## What is implemented and verified

- Original 12-case evaluation set: eight supported full-refund cases, four ambiguous/unsupported cases, plus four failure demonstrations.
- Evidence timeline, immutable preview, exact operator approval and durable operation receipt.
- Full capture refund controls for merchant, buyer, order, capture, integer USD amount, linked grant, independent retained grant, and case version.
- SQLite reservations across all relevant captures. Repeated/concurrent approvals cannot create replacement refunds.
- Separate provider readback and reference-app access verification; pending, rejected, unknown and partially resolved states.
- An actual gated Library feature, an audit trail, and an operator-only manual proposal path for a competent non-AI baseline.
- Real PayPal sandbox REST adapter and real Gemini Interactions adapter, with mocked contract checks and strict result validation.
- Four real MCP tools, tested using both an SDK client transport and a spawned stdio server process.
- Overview dashboard with separate fixture/sandbox totals, ongoing cases, proposed/in-flight/verified refund amounts, searchable status queues and retained-access results.
- 39 offline tests passing, including dashboard accounting and persistent budget enforcement. Typecheck and production build pass.

**Provider verification:** A real end-to-end sandbox case passed: two user-approved $29 purchases, real Gemini analysis selecting the extra capture, exact human refund approval, separate PayPal readback confirming the $29 refund completed, only the extra grant revoked, and the original paid Library opened successfully. Dashboard shows one resolved sandbox case, $58 gross captured and $29 verified refunded. The initial India-buyer currency error was resolved by using a US sandbox buyer. Fixtures remain separately labeled. The original twelve-case Gemini evaluation passed at the decision level (8 supported, 4 deferred); one partial-refund wording issue was corrected and retested. Comparative operator performance and broader merchant compatibility remain unverified.

## Demo desk and presenter guide

Open **Demo desk** in the sidebar for a fresh fixture rehearsal, the completed sandbox result, an ambiguous request, and the manual-versus-AI review pilot. The [showcase guide](docs/GITHUB_PAGES.md) explains the static demo and its presentation flow. Three additional authored challenge cases all deferred as expected; full inputs and responses are in [the challenge record](docs/GEMINI_CHALLENGES_2026-10-04.json). These are focused checks, not general accuracy evidence.

The review pilot records human decisions with server timing, restores an active run at its saved URL and exports results after twelve answers. Six cases are manual and six use recorded Gemini outputs; no new model or payment requests occur. The order and assignment alternate between runs. Decision-stage timing excludes generation and full support-workflow work. Actual human review is still required.

## Fixture walkthrough

1. Open Maya Chen. Read “Please refund the second $29 payment. Keep my original access.”
2. Click **Review fixture proposal**, then **Check facts & preview**.
3. Notice the second capture gets the refund while the first grant remains.
4. Click **Submit for human review**. Check the exact-action checkbox, then **Approve simulated refund**.
5. Observe separate refund and application-access outcomes. Open **the paid Library**: the original grant still opens the chapter.
6. Refresh the operation; the same request stays resolved. Open Noah Williams and review his fixture proposal: ambiguity prevents approval.
7. Other queue entries exercise pending (Taylor), rejected (Robin), lost response (Casey), and partial access failure (Drew). Drew includes a clearly labeled fixture-fault repair action.

Authored fixture proposals are expected answers, not an AI accuracy evaluation. See [evaluation plan](docs/EVALUATION.md).

## PayPal sandbox setup

Only simulated sandbox USD payments are supported. Use a merchant sandbox REST application and a separate sandbox buyer.

1. In ignored `.env`, configure `PAYPAL_CLIENT_ID`, `PAYPAL_CLIENT_SECRET`, `PAYPAL_MERCHANT_ID` (the merchant account ID), and a local `OPERATOR_PASSWORD`. Keep `PAYPAL_ENVIRONMENT=SANDBOX`.
2. Restart and sign in. Open **Connections → Create sandbox case**.
3. Create purchase 1. Follow its **Buyer approval** link, log in yourself as the sandbox buyer, and approve the $29 purchase.
4. Return to the case and choose **Check & capture**. Repeat for purchase 2 with the same buyer. Both orders are stored independently and mapped to separate grants.
5. With an authorized budget configured, choose **Analyze with Gemini**. Alternatively, **Continue with an operator proposal** records a manual, non-AI baseline.
6. Preview, human approve the sandbox refund, read back its status, and open the paid Library.

Do not use live accounts, real payment instruments, account funding, paid services, overages or new credits. No recurring subscription sale IDs, prorations, partial refunds, disputes or arbitrary plugin integrations.

A timeout leaves a durable unknown operation. No automatic POST retry is implemented: a verified refund-idempotency retention interval was not established. Existing capture lookup is not treated as a list of refunds. Reconcile the original request in provider records, then attach a known refund ID; the server validates its capture, currency and amount before updating the case. See [recovery](docs/ARCHITECTURE.md).

## Gemini

The SDK uses Interactions API model `gemini-3.8-flash` (the API name for `models/gemini-3.8-flash`), medium thinking, `max_output_tokens: 65536`, `store: false`, and one constrained `propose_resolution` function call. Structured arguments and evidence IDs are checked server-side before any preview. Customer text is treated as untrusted data.

On October 4 the user authorized $10 total for this app. Local settings are `GEMINI_REQUESTS_ENABLED=true` and `GEMINI_BUDGET_USD=10`; the example defaults remain disabled. New requests reserve $0.50 in the shared `data/gemini-budget.sqlite` ledger before sending. Reservations survive errors and case-database changes, automatic retries are disabled, request size is bounded to 64 KB, and the verified price guard expires January 1, 2027. Reserved amounts are conservative limits, not actual billed charges. Earlier $0.75 reservations are preserved; current total is $9.75 across 18 calls. Preserve this ledger. No substitute model or Claude runtime is used.

## MCP client configuration

The server is local stdio, bound to the same repository database. Configure a trusted client with Node and these arguments (use your own absolute clone path):

```json
{
  "mcpServers": {
    "refund-right": {
      "command": "node",
      "args": ["--import", "tsx", "src/server/mcp.ts"],
      "cwd": "/absolute/path/to/Refund-Right"
    }
  }
}
```

Tools: `prepare_refund_case({caseId})`, `get_refund_preview({caseId})`, `submit_for_approval({previewId})`, `get_resolution_status({caseId})`. Use `case-maya` in a fresh database. A client supporting `cwd` can use this directly; otherwise launch a shell/Node wrapper that sets this exact working directory. `npm run mcp` is available for manual stdio use, but direct Node avoids npm banner output.

There is **no MCP approve, raw-refund, password or session tool**. The browser operator must approve. The stdio process is a trusted local integration, not a hosted multi-tenant service. MCP interoperability tests use real protocol clients without LLM inference.

## Product judgment

The painful moment is clear and the narrow mechanism is demonstrable. PayPal lookup, execution and readback are central to a real resolution. AI's proposed contribution is interpreting free-form intent and conflicting history; its incremental advantage over a capable support operator and purchase-scoped access rules remains unproved. Deterministic rules do the financial safety work. Existing billing assistants and native refund settings are meaningful alternatives. Do not claim essential AI, unique novelty, time savings or competition readiness from fixtures.

The product addresses technological implementation, design and presentation with executable evidence. Impact, AI benefit and innovation still need measured validation. The event requires a functioning PayPal-plus-AI application; this offline-verified build is not a completed submission. See [requirements](docs/HACKATHON_REQUIREMENTS.md), [architecture](docs/ARCHITECTURE.md), and [provider sources](docs/PROVIDER_CONTRACTS.md).

MIT licensed original source and demo copy. Dependencies retain their own licenses. The source repository is private pending the owner’s release decision. No hackathon submission has occurred.



