import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { Workflow } from './workflow.ts';
export function createMcp(workflow: Workflow) {
  const server = new McpServer({ name: 'refund-right', version: '1.0.0' });
  const result = async (fn: () => unknown) => { try { return { content: [{ type: 'text' as const, text: JSON.stringify(await fn()) }] }; } catch (e) { return { isError: true, content: [{ type: 'text' as const, text: (e as Error).message }] }; } };
  server.registerTool('prepare_refund_case', { description: 'Prepare an evidence-backed proposal for a known local merchant case. Fixture results are labeled. No approval or execution.', inputSchema: { caseId: z.string() } }, ({ caseId }) => result(() => workflow.prepare(caseId)));
  server.registerTool('get_refund_preview', { description: 'Read provider facts and create an immutable refund/access preview. Never sends money.', inputSchema: { caseId: z.string() } }, ({ caseId }) => result(() => workflow.preview(caseId)));
  server.registerTool('submit_for_approval', { description: 'Queue exact preview for the authenticated human in the local UI. Cannot approve or execute.', inputSchema: { previewId: z.string() } }, ({ previewId }) => result(() => workflow.submit(previewId)));
  server.registerTool('get_resolution_status', { description: 'Read stored independent refund/access outcomes. Unknown or pending is not complete.', inputSchema: { caseId: z.string() } }, ({ caseId }) => result(() => workflow.status(caseId)));
  return server;
}
