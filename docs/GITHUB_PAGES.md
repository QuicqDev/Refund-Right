# GitHub Pages showcase

This repository contains two separate entry points:

| Build | Purpose | Runtime |
|---|---|---|
| `npm run build` | Full application with server-side PayPal sandbox and Gemini adapters | Node server + SQLite |
| `npm run build:pages` | Interactive sample-data showcase, no provider calls | Static GitHub Pages |

The Pages entry point has no credential fields, backend connection, buyer checkout or live model call. It bundles authored fixtures and recorded Gemini responses. Simulated refunds and sample access checks are visibly labeled. The dashboard updates as a visitor works through cases. State is memory-only; reload or **Reset sample cases** restores the samples. The sample Library is not a secure paid-content gate.

## Build and preview

```sh
npm ci
npm run typecheck
npm test
npm run build:pages
npm run preview:pages
```

Open `http://127.0.0.1:4173/Refund-Right/`. The base path is configured for `https://quicqdev.github.io/Refund-Right/`. Only the files inside `dist-pages/` belong on the website; never upload the repository root, `.env`, `data/`, server records or source maps. The Pages build disables loading `.env` files and emits no source maps.

## Publishing

The code repository is intended to remain private until its owner makes it public. A GitHub Pages site is normally public independently of repository privacy. Private-repository Pages requires an eligible existing GitHub plan; do not change repository visibility or buy a plan automatically.

After the owner approves public website visibility, publish only the built `dist-pages/` contents to a `gh-pages` branch, include an empty `.nojekyll` file, and select that branch and root folder in Settings → Pages. A separate Actions workflow is not required. Keep the source on `main`. Publishing the demo exposes the rendered design, sample content and browser JavaScript even while the source repository remains private.

## Two-minute showcase

1. Show the sample dashboard, then open Maya Chen.
2. Read the duplicate-payment complaint and both receipts.
3. Select **Review recorded AI result**. Explain it is a prior real Gemini response to authored evidence, not a live call.
4. Preview, check the exact-action box and approve the simulated refund.
5. Open the sample Library: one original pass remains. Return to Overview to see updated totals.
6. Open Noah Williams and review the recorded response: clarification prevents a refund action.

For the actual PayPal sandbox integration, follow the full application's README locally. The static site alone does not demonstrate a fresh end-to-end provider transaction.

## Current release status

On October 4, the owner’s QuicqDev organization was verified to be on GitHub Free and Refund-Right was private. Therefore the website cannot be activated while that plan/privacy combination remains in place. The prepared `gh-pages` branch contains only static build output. When the owner makes the repository public, select `gh-pages` and `/ (root)` under Settings → Pages → Deploy from a branch. Expected address: `https://quicqdev.github.io/Refund-Right/`. This address is not a live-site claim until GitHub confirms a successful deployment.
