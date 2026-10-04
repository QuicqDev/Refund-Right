import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { config } from '../src/server/config.ts';
const base = 'http://127.0.0.1:4331/api';
const response = await fetch(base + '/session', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password: config.operatorPassword }) });
if (!response.ok) throw new Error('Local operator sign-in failed. Restart the API after updating .env.');
const cookie = response.headers.get('set-cookie')!.split(';')[0], { csrf } = await response.json();
async function api(path: string, body?: unknown) {
  const r = await fetch(base + path, { method: body === undefined ? 'GET' : 'POST', headers: { Cookie: cookie, 'Content-Type': 'application/json', 'X-CSRF-Token': csrf }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  const data = await r.json(); if (!r.ok) throw new Error(data.error ?? 'Local request failed'); return data;
}
const file = 'data/native-check.json';
mkdirSync('data', { recursive: true });
let id: string;
if (existsSync(file)) id = JSON.parse(readFileSync(file, 'utf8')).caseId;
else {
  const c = await api('/sandbox/cases', { customer: 'Sandbox end-to-end buyer', request: 'I purchased two passes by mistake. Refund the second $29 payment in full, and keep the Library access from my original purchase.' });
  id = c.id; writeFileSync(file, JSON.stringify({ caseId: id }, null, 2));
}
const command = process.argv[2] ?? 'status';
if (command === 'create') console.log(JSON.stringify(await api('/sandbox/' + id + '/orders', {})));
else if (command === 'capture') { const c = await api('/sandbox/' + id + '/capture', { slot: Number(process.argv[3] ?? 0) }); console.log(JSON.stringify({ caseId: c.id, purchases: c.purchases.length })); }
else if (command === 'prepare') {
  const proposal = await api('/cases/' + id + '/prepare', {});
  console.log(JSON.stringify({ caseId: id, proposal }));
  if (proposal.decision === 'refund') {
    const preview = await api('/cases/' + id + '/preview', {});
    await api('/previews/' + preview.id + '/review', {});
    console.log(JSON.stringify({ previewId: preview.id, captureId: preview.captureId, amount: preview.amount, currency: preview.currency, retainedGrantIds: preview.retainedGrantIds, awaitingHumanApproval: true }));
  }
}
else if (command === 'verify') {
  let s = await api('/cases/' + id);
  if (!s.operation) throw new Error('Human refund approval is still pending.');
  await api('/operations/' + s.operation.id + '/reconcile', {});
  s = await api('/cases/' + id);
  const library = await api('/cases/' + id + '/library');
  const settings = await api('/config');
  const proof = { checkedAt: new Date().toISOString(), caseId: id, mode: s.case.mode, proposalSource: s.proposal?.source, purchases: s.case.purchases.map((p: {id:string; amount:number; orderId:string}) => ({captureId:p.id, amount:p.amount, orderId:p.orderId})), operation: s.operation, grants: s.case.grants, library, budget: settings.budget };
  writeFileSync('data/native-resolution-proof.json', JSON.stringify(proof, null, 2));
  console.log(JSON.stringify({ caseId: id, status: s.operation.status, provider: s.operation.provider, refundId: s.operation.refundId, access: s.operation.access, activeGrants: library.grantIds, budget: settings.budget }));
  if (s.operation.status !== 'complete' || s.operation.provider !== 'COMPLETED' || library.grantIds.length !== 1 || library.grantIds[0] !== s.operation.preview.retainedGrantIds[0]) process.exitCode = 1;
}
else { const s = await api('/cases/' + id); console.log(JSON.stringify({ caseId: id, purchases: s.case.purchases.length, checkouts: s.checkouts, resolution: s.operation?.status })); }
