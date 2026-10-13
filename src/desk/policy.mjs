// The desk answers from the systems this PC connected and nothing else: Copilot may call the tools
// of the pilotkit connector servers, which only read. Shell commands, file reads and writes, web
// fetches and other MCP servers are refused, with a reason the model sees so it can answer without them.

export function deskPolicy(servers, onRefused) {
  const allowed = new Set(servers);
  return (req) => {
    if (req.kind === 'mcp' && allowed.has(req.serverName)) return { kind: 'approve-once' };
    const what = req.kind === 'mcp' ? `the ${req.serverName} tool ${req.toolName}` : `${req.kind} access`;
    const reason = `${what} is off in the pilotkit desk; it only reads the connected systems through the pilotkit tools`;
    onRefused?.(req, reason);
    return { kind: 'reject', feedback: `Refused: ${reason}.` };
  };
}
