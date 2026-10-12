// The desk answers from Jira and Confluence and nothing else: Copilot may call the pilotkit MCP
// tools, which only read. Shell commands, file reads and writes, web fetches and other MCP servers
// are refused, with a reason the model sees so it can answer without them.

export const DESK_SERVER = 'pilotkit';

export function deskPolicy(onRefused) {
  return (req) => {
    if (req.kind === 'mcp' && req.serverName === DESK_SERVER) return { kind: 'approve-once' };
    const what = req.kind === 'mcp' ? `the ${req.serverName} tool ${req.toolName}` : `${req.kind} access`;
    const reason = `${what} is off in the pilotkit desk; it only reads Jira and Confluence through the pilotkit tools`;
    onRefused?.(req, reason);
    return { kind: 'reject', feedback: `Refused: ${reason}.` };
  };
}
