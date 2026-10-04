import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import type { AddressInfo } from 'node:net';
import { PayPalSandbox, minor, FixturePayments } from '../src/server/providers.ts';
import { Store } from '../src/server/store.ts';
import { seed, makeCase } from '../src/server/fixtures.ts';
import { Workflow } from '../src/server/workflow.ts';
import { CheckoutService } from '../src/server/checkout.ts';
import { createApp } from '../src/server/http.ts';

test('operator session survives app recreation, remains CSRF protected, and logout/password changes revoke it', async () => {
  const store = new Store(':memory:'); seed(store);
  const p = new FixturePayments(store), flow = new Workflow(store, p, p), checkout = new CheckoutService(store, new PayPalSandbox('', '', ''));
  const servers: ReturnType<ReturnType<typeof createApp>['listen']>[] = [];
  async function launch(password: string) { const server = createApp(flow, checkout, { password, sandboxReady: false }).listen(0, '127.0.0.1'); servers.push(server); await once(server, 'listening'); return 'http://127.0.0.1:' + (server.address() as AddressInfo).port + '/api'; }
  try {
    const first = await launch('test-password');
    const login = await fetch(first + '/session', { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({password:'test-password'}) });
    const cookie = login.headers.get('set-cookie')!.split(';')[0], {csrf} = await login.json();
    assert.match(login.headers.get('set-cookie')!, /HttpOnly/); assert.match(login.headers.get('set-cookie')!, /SameSite=Strict/);
    const second = await launch('test-password');
    assert.equal((await (await fetch(second + '/session', {headers:{Cookie:cookie}})).json()).csrf, csrf);
    assert.equal((await fetch(second + '/session', {headers:{Cookie:cookie,Origin:'https://evil.example'}})).status, 403);
    assert.equal((await fetch(second + '/logout', {method:'POST',headers:{Cookie:cookie}})).status, 403);
    const changed = await launch('different-password');
    assert.equal((await fetch(changed + '/session', {headers:{Cookie:cookie}})).status, 401);
    const stored = store.list<{expires:number}>('session');
    assert.equal(stored.length, 1);
    assert.equal((await fetch(second + '/logout', {method:'POST',headers:{Cookie:cookie,'X-CSRF-Token':csrf}})).status, 200);
    assert.equal((await fetch(first + '/session', {headers:{Cookie:cookie}})).status, 401);
    assert.equal(store.list('session').length, 0);
  } finally { for (const server of servers) { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); } store.close(); }
});

test('expired persisted operator sessions cannot be restored', async () => {
  const store = new Store(':memory:'), p = new FixturePayments(store), flow = new Workflow(store, p, p);
  const app = createApp(flow, new CheckoutService(store, new PayPalSandbox('', '', '')), {password:'',sandboxReady:false});
  const server = app.listen(0,'127.0.0.1'); await once(server,'listening');
  const base = 'http://127.0.0.1:' + (server.address() as AddressInfo).port + '/api';
  try {
    const login = await fetch(base+'/session',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'});
    const cookie = login.headers.get('set-cookie')!.split(';')[0];
    const row = store.db.prepare("SELECT id,payload FROM entries WHERE kind='session'").get()!;
    store.put(String(row.id),'session',{...JSON.parse(String(row.payload)),expires:0});
    assert.equal((await fetch(base+'/session',{headers:{Cookie:cookie}})).status,401);
  } finally { server.closeAllConnections(); await new Promise<void>(resolve=>server.close(()=>resolve())); store.close(); }
});
test('PayPal sandbox adapter contracts: OAuth, capture/order relationship, exact idempotent refund and independent readback', async () => {
  const sent: { url: string; init: RequestInit }[] = [];
  const refund = { id: 'R1', status: 'COMPLETED', amount: { value: '29.00', currency_code: 'USD' }, links: [{ rel: 'up', href: 'https://api-m.sandbox.paypal.com/v2/payments/captures/C1' }] };
  const mock: typeof fetch = async (url, init) => { sent.push({ url: String(url), init: init ?? {} }); const u = String(url); return Response.json(u.endsWith('/token') ? { access_token: 'mock-token', expires_in: 3600 } : u.endsWith('/orders/O1') ? { id: 'O1', status: 'COMPLETED', payer: { payer_id: 'B1' }, purchase_units: [{ payee: { merchant_id: 'M1' }, payments: { captures: [{ id: 'C1', status: 'COMPLETED', amount: { value: '29.00', currency_code: 'USD' } }] } }] } : u.endsWith('/captures/C1') ? { id: 'C1', status: 'COMPLETED', amount: { value: '29.00', currency_code: 'USD' }, supplementary_data: { related_ids: { order_id: 'O1' } } } : refund); };
  const p = new PayPalSandbox('mock-id', 'mock-secret', 'M1', mock), c = { ...makeCase().purchases[0], id: 'C1', orderId: 'O1', merchantId: 'M1', customerId: 'B1', mode: 'sandbox' as const };
  assert.equal((await p.lookup(c)).amount, 2900); const r = await p.refund(c, 'persisted-request'); assert.equal((await p.readRefund(r.id)).status, 'COMPLETED');
  assert.equal(sent.filter(x => x.url.endsWith('/token')).length, 1); assert.ok(sent.every(x => x.url.startsWith('https://api-m.sandbox.paypal.com/')));
  const post = sent.find(x => x.url.endsWith('/refund'))!; assert.equal((post.init.headers as Record<string,string>)['PayPal-Request-Id'], 'persisted-request'); assert.deepEqual(JSON.parse(String(post.init.body)), { amount: { value: '29.00', currency_code: 'USD' } });
  assert.throws(() => p.parseRefund({ ...refund, links: [{ rel: 'up', href: 'https://api.paypal.com/v2/payments/captures/C1' }] }), /sandbox/);
  assert.throws(() => minor('29.001')); assert.throws(() => minor('-29.00')); assert.equal(minor('29.00'), 2900);
});
test('sandbox checkout requires buyer approval, binds both purchases and never retries unknown capture', async () => {
  const store = new Store(':memory:'); const paypal = new PayPalSandbox('mock', 'mock', 'M'); const service = new CheckoutService(store, paypal);
  let orderStatus = 'CREATED', captured = 0; let currentCase = '';
  const order = (slot: number, status = orderStatus) => ({ id: 'O' + slot, status, payer: { payer_id: 'BUYER' }, purchase_units: [{ custom_id: currentCase + ':' + slot, payee: { merchant_id: 'M' }, payments: status === 'COMPLETED' ? { captures: [{ id: 'C' + slot, status: 'COMPLETED', amount: { value: '29.00', currency_code: 'USD' } }] } : {} }], links: [{ rel: 'payer-action', href: 'https://www.sandbox.paypal.com/checkoutnow?token=mock' }] });
  paypal.createOrder = async (id, slot) => { currentCase = id; return order(slot); }; paypal.order = async id => order(Number(id.slice(1))); paypal.captureOrder = async id => { captured++; return order(Number(id.slice(1)), 'COMPLETED'); };
  try { const c = service.createCase('Test buyer', 'Refund the second full payment, retain the first pass.'); await service.create(c.id); await assert.rejects(service.capture(c.id, 0), /buyer must approve/); assert.equal(captured, 0); orderStatus = 'APPROVED'; await service.capture(c.id, 0); await service.create(c.id); await service.capture(c.id, 1); assert.equal(store.require<ReturnType<typeof makeCase>>(c.id).value.purchases.length, 2); assert.equal(captured, 2); orderStatus = 'COMPLETED'; await service.capture(c.id, 1); assert.equal(captured, 2); } finally { store.close(); }
});
test('real HTTP session/CSRF boundary and complete browser-equivalent approval flow', async () => {
  const store = new Store(':memory:'); seed(store); const p = new FixturePayments(store), workflow = new Workflow(store, p, p), checkout = new CheckoutService(store, new PayPalSandbox('', '', ''));
  const app = createApp(workflow, checkout, { password: '', sandboxReady: false }), server = app.listen(0, '127.0.0.1'); await once(server, 'listening');
  const base = 'http://127.0.0.1:' + (server.address() as AddressInfo).port + '/api'; let cookie = '', csrf = '';
  const call = (path: string, body?: unknown, overrides = {}) => fetch(base + path, { method: body === undefined ? 'GET' : 'POST', headers: { 'Content-Type': 'application/json', Cookie: cookie, 'X-CSRF-Token': csrf, ...overrides }, body: body === undefined ? undefined : JSON.stringify(body) });
  try {
    assert.equal((await call('/cases')).status, 401); assert.equal((await call('/session', {}, { Origin: 'https://evil.example' })).status, 403);
    const session = await call('/session', {}); cookie = session.headers.get('set-cookie')!.split(';')[0]; csrf = (await session.json()).csrf;
    assert.equal((await call('/cases/case-maya/prepare', {}, { 'X-CSRF-Token': 'wrong' })).status, 403);
    assert.equal((await call('/cases/case-maya/prepare', {})).status, 200); const preview = await (await call('/cases/case-maya/preview', {})).json(); await call('/previews/' + preview.id + '/review', {});
    const a = { id: preview.id, fingerprint: preview.fingerprint, merchantId: preview.merchantId, captureId: preview.captureId, amount: preview.amount, currency: preview.currency, caseVersion: preview.caseVersion };
    assert.equal((await (await call('/approve', a)).json()).status, 'complete'); const feature = await (await call('/cases/case-maya/library')).json(); assert.equal(feature.grantIds.length, 1);
    assert.equal((await call('/sandbox/cases', { customer: 'X', request: 'A test case' })).status, 409); assert.equal(p.calls, 1);
  } finally { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); store.close(); }
});
test('unknown order capture is never repeated with a new or existing key', async () => {
  const store = new Store(':memory:'), paypal = new PayPalSandbox('mock', 'mock', 'M'), service = new CheckoutService(store, paypal); let captureCalls = 0;
  try {
    const c = service.createCase('Test buyer', 'Refund the second purchase but retain original access.');
    paypal.createOrder = async () => ({ id: 'O', status: 'CREATED', purchase_units: [], links: [{ rel: 'payer-action', href: 'https://www.sandbox.paypal.com/checkoutnow?token=mock' }] });
    paypal.order = async () => ({ id: 'O', status: 'APPROVED', purchase_units: [] });
    paypal.captureOrder = async () => { captureCalls++; throw new Error('lost response'); };
    await service.create(c.id); await assert.rejects(service.capture(c.id, 0), /outcome unknown/); await assert.rejects(service.capture(c.id, 0), /already attempted/); assert.equal(captureCalls, 1);
  } finally { store.close(); }
});
