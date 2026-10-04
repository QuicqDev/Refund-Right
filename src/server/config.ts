import dotenv from 'dotenv';
import { resolve } from 'node:path';
dotenv.config({ path: resolve('.env'), quiet: true });
if ((process.env.PAYPAL_ENVIRONMENT ?? 'SANDBOX').toUpperCase() !== 'SANDBOX') throw new Error('Only PayPal SANDBOX is supported.');
export const config = {
  paypalClientId: process.env.PAYPAL_CLIENT_ID ?? '', paypalSecret: process.env.PAYPAL_CLIENT_SECRET ?? '',
  merchantId: process.env.PAYPAL_MERCHANT_ID ?? '', operatorPassword: process.env.OPERATOR_PASSWORD ?? '',
  geminiKey: process.env.GEMINI_API_KEY ?? '', geminiModel: 'gemini-3.8-flash',
  // October 4: user authorized $10 total for this app. The independent budget ledger
  // also enforces the cap before every request, including evaluation calls.
  geminiEnabled: process.env.GEMINI_REQUESTS_ENABLED === 'true',
  geminiBudgetUsd: Number(process.env.GEMINI_BUDGET_USD ?? '0'),
  geminiBudgetPath: resolve('data/gemini-budget.sqlite'),
  dataPath: process.env.REFUND_RIGHT_DB ?? resolve('data/refund-right.sqlite'),
  webOrigin: process.env.REFUND_RIGHT_WEB_ORIGIN ?? 'http://127.0.0.1:5173',
};

