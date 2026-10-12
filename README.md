<div align="center">
  <img src="site/pilotkit.svg" width="72" alt="pilotkit" />
  <h1>pilotkit</h1>
  <p><strong>Your GitHub Copilot seat, connected to Jira and Confluence in one command.</strong><br/>A read-only Atlassian MCP server, registered with the Copilot CLI and VS Code, plus a local chat desk that shows the AI credits of every answer.</p>

  <p>
    <a href="LICENSE"><img src="https://img.shields.io/badge/license-Apache--2.0-blue?style=flat-square" alt="Apache-2.0 licensed" /></a>
    <img src="https://img.shields.io/badge/Node.js-22.13%2B-339933?style=flat-square&logo=node.js&logoColor=white" alt="Node.js 22.13+" />
    <img src="https://img.shields.io/badge/Copilot%20SDK-1.0-24292f?style=flat-square&logo=githubcopilot&logoColor=white" alt="GitHub Copilot SDK" />
    <img src="https://img.shields.io/badge/MCP%20SDK-1.32-5b21b6?style=flat-square" alt="MCP SDK" />
    <img src="https://img.shields.io/badge/platform-macOS%20%C2%B7%20Windows%20%C2%B7%20Linux-174f3d?style=flat-square" alt="macOS, Windows, Linux" />
  </p>

  <p>
    <a href="#setup"><strong>Setup</strong></a> ·
    <a href="#the-desk">The desk</a> ·
    <a href="#tools">Tools</a> ·
    <a href="#brand-packs">Brand packs</a> ·
    <a href="#security">Security</a>
  </p>
</div>

---

## What it does

A company buys GitHub Copilot seats for everyone. Most people then use it as autocomplete, because the useful part, an assistant that can read their tickets and their team's pages, needs an MCP server, an API token, two config files in two formats and a few words of JSON. pilotkit does that part:

```bash
pilotkit setup    # sign in to Copilot, connect Atlassian, register the tools in the Copilot CLI and VS Code
pilotkit start    # open the desk: chat about your tickets and pages, with the cost of every answer
```

- **One setup command** walks through four steps: GitHub Copilot sign-in (installing the Copilot CLI if needed), the Atlassian site, email and API token (checked against Jira before anything is saved), registration in the Copilot CLI and every VS Code install, and what to do next.
- **A read-only Atlassian MCP server** with seven tools for Jira and Confluence Cloud. It reads with the user's own account, so it sees what they could see in a browser, and it cannot change a ticket or a page.
- **The desk**, a chat page on `127.0.0.1`. It runs Copilot through the official [GitHub Copilot SDK](https://github.com/github/copilot-sdk), records each model call with the credits Copilot reports for it, and shows the cost under every answer, per day and per model.
- **Brand packs**: the public package is neutral, and a team applies its own name, logo and colour with one command, without forking.

Questions that work well: *"What are my open Jira issues, by priority?"*, *"Summarize KEY-123 and its last comments"*, *"Find the Confluence page about the release process and list its steps"*, *"Draft a stand-up update from my issues in progress"*.

## Requirements

- **Node.js 22.13 or newer** (the desk uses the built-in `node:sqlite`).
- **A GitHub Copilot plan** (a company seat or a personal plan), signed in through the Copilot CLI or the GitHub CLI. Setup installs `@github/copilot` and runs `copilot login` when it is missing.
- **An Atlassian Cloud site** (`*.atlassian.net`), your Atlassian email, and an [API token](https://id.atlassian.com/manage-profile/security/api-tokens).
- Optional: **VS Code** with GitHub Copilot Chat, to use the tools in Agent mode.

## Setup

```bash
npm install -g pilotkit
pilotkit setup
```

Recent npm versions warn that they skipped the install script of `koffi`, a dependency of the Copilot SDK. pilotkit does not use it: the warning is harmless.

Setup asks for what it needs and checks each answer:

1. **GitHub Copilot.** Finds the Copilot CLI, offers to install it, and signs in with `copilot login` (a browser page asks for a short code). It prints the account and its monthly allowance.
2. **Jira and Confluence.** Asks for the site (`acme.atlassian.net`), the email and the API token, calls `/rest/api/3/myself` to prove they work, then stores the token in the OS credential store. A wrong token gets two more tries.
3. **Copilot clients.** Runs `copilot mcp add pilotkit -- <node> <pilotkit> mcp` and adds a `pilotkit` server to the user `mcp.json` of VS Code and VS Code Insiders, keeping every other server (and a backup of the original file).
4. **Next steps**, printed for the user.

Every prompt has a flag, for scripted installs:

| Flag | What it does |
|---|---|
| `--brand <folder\|url>` | Apply a brand pack first |
| `--site <url>` | Atlassian site |
| `--email <email>` | Atlassian account email |
| `--new-token` | Ask for a new API token even when one is saved |
| `--port <n>` | Desk port, default `8717` |
| `--skip-copilot` / `--skip-vscode` | Leave that client alone |

`PILOTKIT_ATLASSIAN_TOKEN` supplies the token from the environment instead of the credential store, and `PILOTKIT_HOME` moves `~/.pilotkit` (a second profile, or tests).

## Run

```bash
pilotkit start            # open the desk in the browser (Ctrl+C to close it)
pilotkit start --no-open  # start it without opening a browser
pilotkit doctor           # check Node, Copilot, Atlassian and both registrations, and say what to run
pilotkit credits          # credits spent in the desk, by day and by model (--days 7)
pilotkit brand <folder>   # apply a brand pack; --reset goes back to the neutral look
pilotkit unlink           # remove the tools from Copilot and VS Code and delete the token (--purge also deletes ~/.pilotkit)
pilotkit mcp              # the MCP server on stdio: what Copilot and VS Code start
```

Once set up, the same tools work in four places:

| Where | How |
|---|---|
| The desk | `pilotkit start`, then ask on the Chat page |
| VS Code | Copilot Chat → **Agent** mode → the tools icon lists **pilotkit**. VS Code asks once to trust and start the server. |
| Copilot CLI | `copilot`, then ask. For one question: `copilot -p "Summarize KEY-123" --allow-tool=pilotkit` |
| GitHub Copilot app | `copilot app` opens it. If pilotkit is not in its tool list, add an MCP server with the command `pilotkit mcp`. |

## The desk

`pilotkit start` serves a small web app on `http://127.0.0.1:8717/` with three pages:

- **Chat.** One Copilot session per chat, resumed for follow-ups, with the list of chats on the left (a drawer on phones). While Copilot works, a line says what it is doing ("Searching Jira", "Reading a Confluence page"); the answer streams in as Markdown with links to every issue and page. Above each answer, a line gives its model calls, tool calls and credits; it opens on a timeline, in order, of each model call (model, input tokens, tokens served from cache, output tokens, time, credits) and each tool call (its argument, roughly how many tokens it returned, time). The model and the credit cap for new chats are in the settings menu.
- **Credits.** The Copilot month: credits used against the monthly allowance, the pace against an even plan, today against the daily plan, credits left per day, and where the month ends at this rate. A bar per day splits this desk from the rest of the account's Copilot use, a line follows the month against the plan, and a habits section breaks the desk's own credits down by model, by chat and by prompt cache, with a few plain tips to spend less.
- **Start here.** The state of this PC (Copilot account, Atlassian site) and how to use the tools in each client.

### How credits are counted

Copilot sends an `assistant.usage` event after every model call. Its `copilotUsage.totalNanoAiu` is the cost in nano AI units, and 1e9 of them make one credit. The desk stores that number per call in SQLite. When a call carries no cost, the desk estimates it from the model's published token prices (`billing.tokenPrices`) and marks it with `≈`.

Each chat has a credit cap (default 60, Copilot's minimum is 30), passed to Copilot as `sessionLimits.maxAiCredits`: Copilot stops the session when it is reached. The desk's own system message asks the model to batch tool calls, ask for few results and stop as soon as it can answer, because every call re-sends the whole conversation.

The allowance comes from `account.getQuota`. It counts every Copilot client on the account, and GitHub can take a while to update it. While it runs, the desk reads it every 10 minutes and keeps the readings, so it can split the month into days: the use before its first reading of the month is shown on that day, marked as such. Without a reading (not signed in, or an unlimited plan) the page shows this desk's own credits only.

## Tools

All seven tools are read-only (`readOnlyHint: true`) and return compact Markdown: Atlassian rich text (ADF in Jira, storage XHTML in Confluence) is turned into short text before it reaches the model, because every character a tool returns is re-sent, and billed, with each later model call.

| Tool | Arguments | Returns |
|---|---|---|
| `whoami` | none | The Atlassian site and account the tools use |
| `jira_my_issues` | `include_done?`, `max?` (1–50, default 20) | Issues assigned to the user, most recently updated first, open ones by default |
| `jira_search` | `jql`, `max?`, `nextPageToken?` | Issues matching a JQL query, with a token for the next page |
| `jira_get_issue` | `key`, `comments?` (0–20, default 5), `max_chars?` | Status, people, sprint, description, latest comments, links and sub-tasks |
| `jira_list_projects` | `query?` | Projects the user can see, with their keys |
| `confluence_search` | `query?` or `cql?`, `space?`, `max?` (1–25) | Pages and blog posts: title, space, last update, link and an excerpt |
| `confluence_get_page` | `page` (id or link), `max_chars?` | A page as text |

Atlassian errors come back as text with a hint: a `401` points at the token, a `403` at missing permissions, a `404` at a wrong key or a page the user cannot see, a `410` at an API Atlassian has retired. A `429` is retried after the `Retry-After` delay.

## Brand packs

A brand pack is a folder with a `brand.json` and a logo. It puts a company's name, logo and colour on the desk and in the setup text, so the people installing it recognise their own tool:

```bash
pilotkit setup --brand ./brand-acme
pilotkit brand https://intranet.example.com/pilotkit/brand.json
```

```json
{
  "name": "Acme",
  "product": "Acme Copilot desk",
  "logo": "logo.svg",
  "accent": "#c2410c",
  "welcome": "Ask about your Acme Jira tickets and Confluence pages.",
  "atlassianSite": "https://acme.atlassian.net",
  "links": [{ "label": "Ask for help", "url": "https://example.com/help" }]
}
```

`name` and `logo` (an `.svg` or `.png` next to `brand.json`, 512 KB at most) are required. `atlassianSite` pre-fills the site question in setup; `links` (https only, six at most) appear under the welcome text. The pack is checked and copied into `~/.pilotkit/brand`. See [`examples/brand-acme`](examples/brand-acme) for a complete, fictional one.

**Keep your company's marks in your own pack.** A logo is a trademark: share the pack inside the company (a folder on a share, an intranet URL) and leave pilotkit itself neutral.

## Security

- **Read-only by construction.** The MCP server only sends `GET` requests to Atlassian. It has no tool that writes, comments or transitions; ask for a draft and paste it yourself.
- **The token never lands in a config file.** It goes to the macOS Keychain (through `security -i` on stdin, never on a command line), to a DPAPI-protected file on Windows that only the same Windows user on the same PC can decrypt, or to the Linux Secret Service (a `0600` file when there is none). The MCP server reads it at start. `config.json` holds only the site, the email and desk settings.
- **The desk only takes Atlassian tools.** Its Copilot sessions see only the `pilotkit` tools (`availableTools`), skip custom instructions, run in an empty working folder, and a permission handler refuses anything else (shell, files, URLs, other MCP servers) with a reason the model can read. Refusals are recorded and shown in the call table.
- **The desk listens on `127.0.0.1` only** and rejects requests whose `Host` is not `127.0.0.1` or `localhost` on its port, which stops DNS rebinding. Every write needs an `X-Pilotkit: 1` header, which a cross-site form or image cannot send, so another web page cannot spend credits. Pages carry a strict Content-Security-Policy (`script-src 'self'`, `frame-ancestors 'none'`).
- **No telemetry.** pilotkit talks to your Atlassian site and, through the Copilot SDK, to GitHub. Nothing else.

## Where things live

| What | Where |
|---|---|
| Settings, desk history, brand pack | `~/.pilotkit/` (`config.json`, `desk.db`, `brand/`) |
| Atlassian token | macOS Keychain service `pilotkit-atlassian`; `~/.pilotkit/atlassian.token` (DPAPI) on Windows; Secret Service on Linux |
| Copilot CLI registration | `~/.copilot/mcp-config.json`, through `copilot mcp add` |
| VS Code registration | The user `mcp.json`: `~/Library/Application Support/Code/User/` (macOS), `%APPDATA%\Code\User\` (Windows), `~/.config/Code/User/` (Linux) |

## Tech stack

| Layer | What |
|---|---|
| Runtime | Node.js 22.13+, ES modules, no build step |
| Copilot | [`@github/copilot-sdk`](https://www.npmjs.com/package/@github/copilot-sdk) 1.0: sessions, streaming, usage events, permission handler, quota |
| MCP | [`@modelcontextprotocol/sdk`](https://www.npmjs.com/package/@modelcontextprotocol/sdk) 1.32, stdio transport, `zod` 4 schemas |
| Atlassian | Jira Cloud REST v3 (`/search/jql`), Confluence REST v1 search and v2 pages, basic auth with an API token |
| Desk | `node:http`, `node:sqlite`, Server-Sent Events, plain HTML, CSS and JavaScript (no framework, no bundler) |
| Tests | `node:test` |

## Repository layout

```text
bin/pilotkit.mjs        the CLI: setup, start, doctor, credits, brand, unlink, mcp
src/
  config.mjs            ~/.pilotkit paths, config.json, site normalisation
  secrets.mjs           the token in the Keychain, DPAPI or the Secret Service
  clients.mjs           registration in the Copilot CLI and VS Code (JSONC-safe)
  brand.mjs             brand pack validation, install, load
  atlassian/            REST client, ADF and storage-format to text, the seven tools, the MCP server
  cli/                  setup, doctor and unlink, credits, terminal prompts
  desk/                 HTTP server, Copilot session runner, SQLite schema, month report, tool policy
site/                   the desk: chat, credits and start pages, Markdown renderer, default logo, fonts
examples/brand-acme/    a fictional brand pack
test/                   node:test suites
changelog/unreleased/   one changelog fragment per PR, collated into CHANGELOG.md
```

## Development

```bash
npm install
npm test                                   # node:test, no network
PILOTKIT_HOME=/tmp/pk node bin/pilotkit.mjs doctor
PILOTKIT_HOME=/tmp/pk node bin/pilotkit.mjs start --port 8799
```

## Verification status

Checked on 2026-10-12 on macOS with Node 24, Copilot CLI 1.0.91 and a real Jira and Confluence Cloud site:

| Part | Status |
|---|---|
| All seven MCP tools | Verified live, including the `404` hint |
| Desk: new chat, streaming, follow-up in the same session, credits per call | Verified live in Chromium (desktop, 390 px and 320 px) |
| Credits page, brand pack, Host and header guards, path traversal | Verified live |
| macOS Keychain token | Verified |
| Copilot CLI registration | Verified with Copilot CLI 1.0.91 in a scratch `COPILOT_HOME` (add, replace, remove) |
| VS Code registration | Covered by tests on a JSONC `mcp.json` with other servers |
| Windows (DPAPI token, `.cmd` shims) | **Not yet verified on a Windows PC** |
| Linux (Secret Service) | **Not yet verified** |
| npm package | `npm pack` tarball installed globally into a scratch prefix: `--version`, `--help`, and the desk reaching Copilot, without koffi's install script |

## Notes

- The Copilot runtime counts a credit cap per session and refuses one under 30, so the desk's minimum cap is 30.
- `auto` lets Copilot pick a model for each call; every call still records the model it used, so the credits page shows the real split.
- pilotkit asks Jira for issues with the user's own permissions. It is not an admin tool and does not need an Atlassian admin.
- A chat's history stays in `~/.pilotkit/desk.db`; **Archive** hides a chat from the list.

## License

Apache-2.0. GitHub and GitHub Copilot are trademarks of GitHub, Inc.; Atlassian, Jira and Confluence are trademarks of Atlassian. pilotkit is an independent project, not affiliated with or endorsed by either.

---

<div align="center">
  <sub>Built by <a href="https://heybrahim.com/">Brahim Bousnguar</a>, a MuleSoft integration engineer — available for platform and agentic-AI consulting.</sub>
</div>
