import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { runtime } from './runtime.ts';
import { createMcp } from './mcp-server.ts';
const { workflow } = runtime();
await createMcp(workflow).connect(new StdioServerTransport());
