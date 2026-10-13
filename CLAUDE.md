# CLAUDE.md

Guidance for Claude Code when working in this repository.

## Commands

```bash
npm install
npm test                                        # node:test over test/*.test.mjs, no network
PILOTKIT_HOME=/tmp/pk node bin/pilotkit.mjs doctor
PILOTKIT_HOME=/tmp/pk node bin/pilotkit.mjs start --port 8799 --no-open
```

Plain ES modules, no build step: `bin/`, `src/` and `site/` ship as they are. Node 22.13+
(`node:sqlite`). Use a throwaway `PILOTKIT_HOME` (and `COPILOT_HOME`, `PILOTKIT_VSCODE_USER_DIR`)
for anything that writes, so a test never touches a real setup.

## Architecture

- `bin/pilotkit.mjs`: the CLI. Commands import their module lazily, so `pilotkit mcp` starts fast.
- `src/connectors/`: one connector per system (`atlassian.mjs` today), listed in `index.mjs`. Each has its
  own MCP server, `pilotkit-<id>`, registered on its own; it brings its setup step, doctor check,
  credential removal, desk guide lines and `serve()`. `config.connectors` lists the ones added.
- `src/atlassian/`: `client.mjs` (GET-only REST client, hints per status), `text.mjs` (ADF and
  storage XHTML to short text), `tools.mjs` (the seven tools), `mcp.mjs` (stdio server).
- `src/clients.mjs`: registration of a named server with the Copilot CLI (`copilot mcp add`) and
  VS Code (user `mcp.json`, JSONC-tolerant, backup first), dropping the old names it `replaces`
  (0.2's `pilotkit`). `serverLaunch(id)` decides the command clients run.
- `src/secrets.mjs`: the Atlassian token in the macOS Keychain, a DPAPI file on Windows, or the
  Secret Service on Linux. `PILOTKIT_ATLASSIAN_TOKEN` overrides.
- `src/desk/`: `server.mjs` (HTTP + SSE on 127.0.0.1), `runner.mjs` (one Copilot SDK session per
  chat, usage events to credits), `db.mjs` (SQLite schema, credit report for `pilotkit credits`),
  `month.mjs` (quota readings every 10 minutes and the Credits page's month report), `policy.mjs`.
- `site/`: the desk pages, plain JS modules (`common.js`, `app.js`, `credits.js`, `start.js`,
  `md.js`). No framework and no bundler; the CSP forbids inline scripts. Atlas look, light only:
  tokens at the top of `app.css`, fonts self-hosted in `site/fonts/` (OFL, see `LICENSES.txt`).

## Invariants

- **Read-only.** No tool may write to Jira, Confluence or any other connected system. A write tool would be a different product.
- **One MCP server per connector.** Never merge systems into one server: Copilot sends every enabled
  tool's description with each request, so users must be able to add only what they need.
- **The token never lands in a file a user shares**: not in `config.json`, not in an MCP config.
- **Nothing company-specific in this repo**: no customer names, Atlassian sites, project keys or
  logos. Companies brand pilotkit with a brand pack kept outside the repo (`examples/brand-acme`
  is fictional on purpose).
- **The desk stays local**: bound to 127.0.0.1, Host checked, `X-Pilotkit: 1` on every write.
- **Credits come from Copilot** (`assistant.usage` → `copilotUsage.totalNanoAiu / 1e9`); the
  price-based estimate is only a fallback and is marked `estimated`.
- Tool output is compact on purpose: every character is re-sent, and billed, on each later call.
