import test from 'node:test';
import assert from 'node:assert/strict';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { Store } from '../src/server/store.ts';
import { seed } from '../src/server/fixtures.ts';
import { FixturePayments } from '../src/server/providers.ts';
import { Workflow } from '../src/server/workflow.ts';
import { createMcp } from '../src/server/mcp-server.ts';
async function exercise(client: Client) {
  const listed = await client.listTools(); assert.deepEqual(listed.tools.map(t => t.name).sort(), ['get_refund_preview', 'get_resolution_status', 'prepare_refund_case', 'submit_for_approval']);
  const prepared = await client.callTool({ name: 'prepare_refund_case', arguments: { caseId: 'case-maya' } }); assert.equal(prepared.isError, undefined);
  const p = await client.callTool({ name: 'get_refund_preview', arguments: { caseId: 'case-maya' } });
  const preview = JSON.parse((p.content as { text: string }[])[0].text);
  const review = await client.callTool({ name: 'submit_for_approval', arguments: { previewId: preview.id } });
  assert.equal(JSON.parse((review.content as { text: string }[])[0].text).status, 'awaiting_human');
  const status = await client.callTool({ name: 'get_resolution_status', arguments: { caseId: 'case-maya' } }); assert.equal(JSON.parse((status.content as { text: string }[])[0].text).operation, undefined);
  assert.equal((await client.callTool({ name: 'refund', arguments: {} })).isError, true);
}
test('actual MCP client handshake, discovery and workflow through SDK transport', async () => {
  const store = new Store(':memory:'); seed(store); const provider = new FixturePayments(store), server = createMcp(new Workflow(store, provider, provider));
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair(); const client = new Client({ name: 'support-assistant-test', version: '1.0' });
  try { await server.connect(serverTransport); await client.connect(clientTransport); await exercise(client); assert.equal(provider.calls, 0); } finally { await client.close(); await server.close(); store.close(); }
});
test('native stdio MCP server process interoperates with actual client', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'refund-right-mcp-'));
  const transport = new StdioClientTransport({ command: process.execPath, args: ['--import', 'tsx', 'src/server/mcp.ts'], cwd: resolve('.'), env: { ...Object.fromEntries(Object.entries(process.env).filter((e): e is [string,string] => e[1] !== undefined)), REFUND_RIGHT_DB: join(dir, 'test.sqlite') }, stderr: 'pipe' });
  const client = new Client({ name: 'configured-support-client', version: '1.0' });
  try { await client.connect(transport); await exercise(client); } finally { await client.close(); await transport.close(); rmSync(dir, { recursive: true, force: true }); }
});
