# Primary contracts checked — October 4, 2026

Implementation uses the installed package types as well as current primary documentation. No real provider request was sent.

| Contract | Source | Implementation consequence |
|---|---|---|
| Gemini Interactions model and storage | [Interactions overview](https://ai.google.dev/gemini-api/docs/interactions-overview) | gemini-3.8-flash, store:false, no previous interaction ID |
| Structured function calls | [Gemini function calling](https://ai.google.dev/gemini-api/docs/function-calling) | tools use type:function; response steps contain function_call name/arguments; generation_config contains tool_choice.allowed_tools |
| Model SDK | Installed @google/genai 2.27.0 declarations | SDK-typed interactions.create; medium thinking and 65536 max output tokens compile |
| OAuth | [PayPal authentication](https://developer.paypal.com/api/rest/authentication/) | Server-side client-credentials token; fixed sandbox token URL |
| Order creation | [Orders v2 create](https://developer.paypal.com/api/orders/v2/orders-create) | CAPTURE intent, one USD purchase unit, custom_id, payee merchant ID, PayPal experience_context and buyer approval URL |
| Capture | [Orders v2 capture](https://developer.paypal.com/api/orders/v2/orders-capture) | Explicit buyer approval before capture; stable capture request ID |
| Capture refund | [Payments v2 refund](https://developer.paypal.com/api/payments/v2/captures-refund) | Full exact amount, PayPal-Request-Id, Prefer:return=representation |
| Refund lookup | [Payments v2 refund GET](https://developer.paypal.com/api/payments/v2/refunds-get) | Verify a known refund ID and capture relation through links; do not invent a capture refund list |
| Idempotency | [PayPal idempotency](https://developer.paypal.com/api/rest/reference/idempotency/) | Retention is finite and endpoint-specific; no indefinite retry claims or new-key timeout retry |
| MCP | [Official SDK index](https://modelcontextprotocol.io/docs/sdk), [TypeScript v1 SDK](https://github.com/modelcontextprotocol/typescript-sdk/tree/v1.x) | Pinned @modelcontextprotocol/sdk 1.32.0, McpServer, StdioServerTransport, Client and StdioClientTransport |

The refund endpoint page checked did not state a usable retention interval. Therefore the app never automatically repeats an uncertain refund POST, even with the original key. It reconciles known refund IDs, or leaves an operator-owned hold. Actual sandbox response links, buyer/account binding, pending behavior and end-to-end outcomes still require live sandbox verification.

No public evidence here establishes that Gemini outperforms rules or competent support. That is a separate evaluation.

