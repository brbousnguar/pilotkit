import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { VERSION, loadConfig } from '../config.mjs';
import { createSalesforce, loginCommand, orgLabel } from './client.mjs';
import { isLoginError } from './sf.mjs';
import { TOOLS } from './tools.mjs';

// The stdio MCP server that VS Code, the Copilot CLI and the pilotkit desk start.
// stdout carries the protocol, so every log line goes to stderr.

export function createSalesforceMcpServer({ api } = {}) {
  const server = new McpServer({ name: 'pilotkit-salesforce', version: VERSION });
  let client = api ?? null;
  let setupError = null;

  const connect = () => {
    if (client || setupError) return client;
    try {
      client = createSalesforce(loadConfig().salesforce);
    } catch (err) {
      setupError = err.message;
    }
    return client;
  };

  for (const tool of TOOLS) {
    server.registerTool(tool.name, {
      title: tool.title,
      description: tool.description,
      inputSchema: tool.input,
      annotations: { readOnlyHint: true, openWorldHint: true },
    }, async (args) => {
      const c = connect();
      if (!c) return { content: [{ type: 'text', text: setupError }], isError: true };
      try {
        return { content: [{ type: 'text', text: await tool.run(c, args ?? {}) }] };
      } catch (err) {
        const org = (() => { try { return c.pick(args?.org); } catch { return null; } })();
        const fix = isLoginError(err) && org ? ` The sf CLI login for ${orgLabel(org)} no longer works: run "${loginCommand(org)}" in a terminal.` : '';
        return { content: [{ type: 'text', text: `Salesforce error: ${err.message}${fix}` }], isError: true };
      }
    });
  }
  return server;
}

export async function runMcp() {
  const server = createSalesforceMcpServer();
  await server.connect(new StdioServerTransport());
  console.error(`pilotkit-salesforce ${VERSION} MCP server ready on stdio`);
}
