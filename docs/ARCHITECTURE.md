# Architecture and recovery

The React/Vite UI talks only to the loopback Express API. The same Workflow service backs the UI and the stdio MCP server. Node's SQLite database persists case facts, per-purchase grants, proposals, immutable previews, review requests, operations, capture reservations and audit records. All state is project-local.

## Financial boundary

1. Evidence is trusted only as persisted reference-app purchase records. The customer complaint is untrusted data.
2. Gemini or an authored fixture supplies a non-executing proposal. The manual baseline is separately labeled.
3. A preview verifies both captures using the selected provider; validates merchant, customer, order, amount, currency and status; and requires an active independent grant.
4. The browser requests review. Its approval includes preview ID, fingerprint, merchant, capture, exact amount, USD currency and case version.
5. Execution checks facts again, then commits a unique operation and UUID PayPal-Request-Id in SQLite **before** the refund request. Reservations cover both the target and retained purchase, preventing two local operations from refunding each other's retained access.
6. A successful refund POST provides a refund ID. A separate refund GET verifies amount, currency, capture relationship and status. The provider completion is persisted before application changes.
7. The access adapter revokes only the refunded purchase's grant, then calls the actual paid-feature authorization path. The operator can open the same feature in the UI.

No transaction spans PayPal and SQLite. The app cannot atomically roll back a refund, guarantee external merchant behavior, or prevent a separate actor changing PayPal state. There are no webhooks or arbitrary membership-plugin handlers.

## Authentication and scope

Fixture mode is a trusted, local OS-user workspace. When configured, the operator password creates a limited-life HttpOnly SameSite=Strict local session. Write routes require a session CSRF token; host/origin checks reject external browser origins. Sandbox setup/refunds require the password-authenticated session. Credentials and provider tokens remain server-side; API errors omit provider response bodies.

This is not production identity management: no separate staff accounts, remote deployment, multi-tenant authorization or customer login is implemented. The paid Library opens as an operator-view of a specific customer's grant authorization. It proves the access mechanism within this reference app. Stdio MCP access trusts the OS identity and can read cases/request reviews, but exposes no approval/payment execution tool.

## Recovery states

| State | Meaning | Next action |
|---|---|---|
| executing | Durable approval exists; provider call may be in flight | Observe this operation; never create another request |
| pending | Refund GET says PENDING | Refresh the same refund; keep access unchanged |
| rejected | Known provider rejection, FAILED or CANCELLED | Keep grants and examine provider evidence; operation remains reserved |
| unknown | Timeout, lost response, malformed or mismatched response, or interrupted execution | Reconcile original request/capture in provider records; do not send another refund |
| partial | Refund completed, access update/check failed | Repair the supported access ledger and refresh the same operation |
| complete | Completed refund readback plus actual retained-feature authorization | Open Library to demonstrate the retained grant |

A permanently held reservation is intentional in this MVP. There is no “try with a new key” path even for rejected operations. Retrying an idempotent POST requires a verified endpoint retention window; no such automatic retry is assumed here.

For an unknown refund with no ID: the operator owns recovery. Use the operation receipt, original request ID, approved capture, merchant, amount and currency to locate provider evidence. Attach a known refund ID through the application; the GET response must have the correct capture relationship and exact amount/currency. This establishes the approved financial outcome, not proof that the app was the actor if another operator performed the same full refund. An unrelated refund ID cannot release the hold.

Order setup persists separate create and capture UUIDs before provider calls. Unknown order creation without an order ID requires provider reconciliation outside this MVP. Unknown capture can be recovered by reading the known order; capture is never resent automatically. There is deliberately no claim that every unknown outcome is self-healing.

For the authored access-failure demonstration only, a labeled control clears the simulated local fault and repeats access reconciliation. It cannot act on sandbox cases and never refunds again.

## Independent adapters

- PayPalSandbox: fixed sandbox host, OAuth client credentials, Orders v2 creation/lookup/capture, capture lookup, Payments v2 refund and refund lookup. USD exact decimal parsing into integer minor units.
- FixturePayments: deterministic persisted provider simulation, including pending/failure/lost-response cases.
- Gemini: @google/genai Interactions contract, stateless request and one validated tool result. Hard budget lock remains.
- Reference application: separate grants per capture; an active, unexpired grant authorizes the Library chapter.
- MCP: @modelcontextprotocol/sdk v1 stdio; the four bounded tools call the same Workflow methods.

The tests validate authored scenarios and mocked provider contracts. They do not replace real sandbox or model trials.

