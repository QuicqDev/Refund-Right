import express from 'express';
import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import { Workflow } from './workflow.ts';
import { CheckoutService } from './checkout.ts';
import { config } from './config.ts';
import { ReviewPilot } from './review-pilot.ts';
import { makeCase } from './fixtures.ts';
import { randomUUID } from 'node:crypto';
const approvalSchema = z.object({ id: z.string(), fingerprint: z.string(), merchantId: z.string(), captureId: z.string(), amount: z.number().int(), currency: z.literal('USD'), caseVersion: z.number().int() }).strict();
export function createApp(workflow: Workflow, checkout: CheckoutService, settings: { password: string; sandboxReady: boolean }) {
  const app = express(); app.disable('x-powered-by'); app.use(express.json({ limit: '20kb' }));
  type Session = { csrf: string; expires: number; sandbox: boolean; passwordTag: string };
  const sessionKey = (id: string) => 'session:' + createHash('sha256').update(id).digest('hex');
  const passwordTag = (id: string) => createHmac('sha256', id).update(settings.password).digest('hex');
  const allowed = ['http://127.0.0.1:5173', 'http://localhost:5173', 'http://127.0.0.1:4331', 'http://localhost:4331'];
  app.use('/api', (req, res, next) => {
    const host = req.headers.host?.split(':')[0];
    if (!['127.0.0.1', 'localhost'].includes(host ?? '') || (req.headers.origin && !allowed.includes(req.headers.origin))) { res.status(403).json({ error: 'Only the local operator workspace may access this API.' }); return; }
    res.setHeader('Cache-Control', 'no-store'); next();
  });
  app.get('/api/config', (_req, res) => res.json({ model: 'gemini-3.8-flash', geminiEnabled: config.geminiEnabled && config.geminiBudgetUsd > 0, budget: workflow.budget?.snapshot() ?? { capUsd: 0, reservedUsd: 0, calls: 0 }, sandboxReady: settings.sandboxReady && !!settings.password, passwordRequired: !!settings.password }));
  let attempts = 0, resetAt = Date.now();
  app.post('/api/session', (req, res) => {
    if (Date.now() - resetAt > 60000) { attempts = 0; resetAt = Date.now(); }
    if (++attempts > 20) { res.status(429).json({ error: 'Too many sign-in attempts. Try in a minute.' }); return; }
    const password = z.object({ password: z.string().max(300).optional() }).parse(req.body).password ?? '';
    const a = Buffer.from(password), b = Buffer.from(settings.password);
    if (b.length && (a.length !== b.length || !timingSafeEqual(a, b))) { res.status(401).json({ error: 'Operator password is incorrect.' }); return; }
    const id = randomBytes(32).toString('hex'), csrf = randomBytes(32).toString('hex');
    for (const row of workflow.store.db.prepare("SELECT id,payload FROM entries WHERE kind='session'").all()) {
      if (JSON.parse(String(row.payload)).expires < Date.now()) workflow.store.db.prepare('DELETE FROM entries WHERE id=?').run(String(row.id));
    }
    workflow.store.put(sessionKey(id), 'session', { csrf, expires: Date.now() + 8 * 3600000, sandbox: !!settings.password, passwordTag: passwordTag(id) } satisfies Session);
    res.cookie('rr_session', id, { httpOnly: true, sameSite: 'strict', path: '/api', maxAge: 8 * 3600000 }); res.json({ csrf, operator: 'Local support operator' });
  });
  app.use('/api', (req, res, next) => {
    const id = req.headers.cookie?.match(/(?:^|;\s*)rr_session=([a-f0-9]{64})(?:;|$)/)?.[1], session = id ? workflow.store.get<Session>(sessionKey(id))?.value : undefined;
    if (!session || session.expires < Date.now() || session.passwordTag !== passwordTag(id!)) { res.status(401).json({ error: 'Sign in to the local support workspace.' }); return; }
    if (req.method !== 'GET' && req.headers['x-csrf-token'] !== session.csrf) { res.status(403).json({ error: 'Operator action token required.' }); return; }
    res.locals.session = session; next();
  });
  app.get('/api/session', (_req, res) => res.json({ csrf: res.locals.session.csrf, operator: 'Local support operator' }));
  app.post('/api/logout', (req, res) => {
    const id = req.headers.cookie!.match(/(?:^|;\s*)rr_session=([a-f0-9]{64})(?:;|$)/)![1];
    workflow.store.db.prepare('DELETE FROM entries WHERE id=?').run(sessionKey(id));
    res.clearCookie('rr_session', { httpOnly: true, sameSite: 'strict', path: '/api' }); res.json({ signedOut: true });
  });
  app.get('/api/cases', (_req, res) => res.json(workflow.list()));
  app.post('/api/demo/rehearsal', (_req, res) => {
    const c = makeCase('rehearsal-' + randomUUID());
    c.customer = 'Maya · Demo rehearsal';
    workflow.store.transaction(() => {
      workflow.store.insert(c.id, 'case', c);
      for (const purchase of c.purchases) workflow.store.insert('capture:' + purchase.id, 'capture', purchase);
    });
    res.json({ id: c.id });
  });
  const pilot = new ReviewPilot(workflow.store);
  app.post('/api/review-pilots', (req, res) => res.json(pilot.create(z.object({ familiar: z.boolean() }).strict().parse(req.body).familiar)));
  app.get('/api/review-pilots/:id', (req, res) => res.json(pilot.view(req.params.id)));
  app.post('/api/review-pilots/:id/begin', (req, res) => res.json(pilot.begin(req.params.id)));
  app.post('/api/review-pilots/:id/answer', (req, res) => res.json(pilot.answer(req.params.id, req.body)));
  app.get('/api/cases/:id', (req, res) => res.json({ ...workflow.status(req.params.id), checkouts: checkout.list(req.params.id) }));
  app.post('/api/cases/:id/prepare', async (req, res) => res.json(await workflow.prepare(req.params.id)));
  app.post('/api/cases/:id/manual-proposal', (req, res) => {
    if (workflow.case(req.params.id).value.mode === 'sandbox' && !res.locals.session.sandbox) { res.status(403).json({ error: 'Operator password required for sandbox review.' }); return; }
    const body = z.object({ captureId: z.string(), reason: z.string().min(15).max(1800) }).strict().parse(req.body);
    res.json(workflow.manualProposal(req.params.id, body.captureId, body.reason));
  });
  app.post('/api/cases/:id/repair-fixture', async (req, res) => {
    const c = workflow.case(req.params.id).value, op = workflow.status(c.id).operation;
    if (c.mode !== 'fixture' || c.scenario !== 'access_failure' || op?.status !== 'partial') { res.status(409).json({ error: 'Only the simulated access-update fault can be cleared here.' }); return; }
    c.scenario = 'completed'; workflow.store.put(c.id, 'case', c); workflow.store.audit('fixture_fault_cleared', c.id, {});
    res.json(await workflow.reconcile(op.id));
  });
  app.post('/api/cases/:id/preview', async (req, res) => res.json(await workflow.preview(req.params.id)));
  app.post('/api/previews/:id/review', (req, res) => res.json(workflow.submit(req.params.id)));
  app.post('/api/approve', async (req, res) => {
    const a = approvalSchema.parse(req.body), p = workflow.store.require<import('../shared/types.ts').Preview>(`preview:${a.id}`).value;
    if (workflow.case(p.caseId).value.mode === 'sandbox' && !res.locals.session.sandbox) { res.status(403).json({ error: 'Configure OPERATOR_PASSWORD and sign in before sandbox refunds.' }); return; }
    res.json(await workflow.approve(a, 'Local support operator'));
  });
  app.post('/api/operations/:id/reconcile', async (req, res) => {
    const input = z.object({ refundId: z.string().min(1).max(100).optional() }).strict().parse(req.body);
    res.json(await workflow.reconcile(req.params.id, input.refundId));
  });
  app.get('/api/cases/:id/library', (req, res) => { const feature = workflow.paidFeature(req.params.id); workflow.store.audit('paid_feature_opened', req.params.id, { grantIds: feature.grantIds }); res.json(feature); });
  app.get('/api/audit', (_req, res) => res.json(workflow.store.history()));
  app.use('/api/sandbox', (_req, res, next) => { if (!res.locals.session.sandbox || !settings.sandboxReady) { res.status(409).json({ error: 'Set sandbox credentials, merchant ID and OPERATOR_PASSWORD, then sign in.' }); return; } next(); });
  app.post('/api/sandbox/cases', (req, res) => { const body = z.object({ customer: z.string().min(1).max(100), request: z.string().min(10).max(2000) }).strict().parse(req.body); res.json(checkout.createCase(body.customer, body.request)); });
  app.post('/api/sandbox/:id/orders', async (req, res) => res.json(await checkout.create(req.params.id)));
  app.post('/api/sandbox/:id/capture', async (req, res) => { const body = z.object({ slot: z.number().int().min(0).max(1) }).strict().parse(req.body); res.json(await checkout.capture(req.params.id, body.slot)); });
  app.use('/api', (_req, res) => res.status(404).json({ error: 'Unknown API endpoint.' }));
  app.use((error: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => { res.status(400).json({ error: error instanceof z.ZodError ? 'Invalid request or provider response. Check the evidence and try again.' : error.message }); });
  return app;
}
