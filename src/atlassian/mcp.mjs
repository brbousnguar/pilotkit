import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { VERSION, loadConfig } from '../config.mjs';
import { readToken } from '../secrets.mjs';
import { createAtlassian } from './client.mjs';
import { TOOLS } from './tools.mjs';

// The stdio MCP server that VS Code, the Copilot CLI and the pilotkit desk start.
// stdout carries the protocol, so every log line goes to stderr.

export function createPilotkitMcpServer({ api } = {}) {
  const server = new McpServer({ name: 'pilotkit-atlassian', version: VERSION });
  let client = api ?? null;
  let setupError = null;

  const connect = () => {
    if (client || setupError) return client;
    try {
      const { atlassian } = loadConfig();
      client = createAtlassian({ ...atlassian, token: readToken(atlassian.email) });
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
        return { content: [{ type: 'text', text: `Atlassian error: ${err.message}` }], isError: true };
      }
    });
  }
  return server;
}

export async function runMcp() {
  const server = createPilotkitMcpServer();
  await server.connect(new StdioServerTransport());
  console.error(`pilotkit-atlassian ${VERSION} MCP server ready on stdio`);
}
