<div align="center">
  <img src="https://raw.githubusercontent.com/brbousnguar/pilotkit/main/site/pilotkit.svg" width="72" alt="pilotkit" />
  <h1>pilotkit</h1>
  <p><strong>Your GitHub Copilot seat, connected to Jira and Confluence in one command.</strong><br/>A read-only Atlassian MCP server, registered with the Copilot CLI and VS Code, plus a local chat desk that shows the AI credits of every answer.</p>

  <p>
    <a href="https://www.npmjs.com/package/pilotkit"><img src="https://img.shields.io/npm/v/pilotkit?style=flat-square&color=cb3837&logo=npm&logoColor=white" alt="pilotkit on npm" /></a>
    <a href="LICENSE"><img src="https://img.shields.io/badge/license-Apache--2.0-blue?style=flat-square" alt="Apache-2.0 licensed" /></a>
    <img src="https://img.shields.io/badge/Node.js-22.13%2B-339933?style=flat-square&logo=node.js&logoColor=white" alt="Node.js 22.13+" />
    <img src="https://img.shields.io/badge/Copilot%20SDK-1.0-24292f?style=flat-square&logo=githubcopilot&logoColor=white" alt="GitHub Copilot SDK" />
    <img src="https://img.shields.io/badge/MCP%20SDK-1.32-5b21b6?style=flat-square" alt="MCP SDK" />
    <img src="https://img.shields.io/badge/platform-macOS%20%C2%B7%20Windows%20%C2%B7%20Linux-174f3d?style=flat-square" alt="macOS, Windows, Linux" />
  </p>

  <p>
    <a href="https://heybrahim.com/notes/pilotkit-copilot-jira-confluence.html"><strong>How it works</strong></a> ·
    <a href="https://heybrahim.com/projects/pilotkit.html">Project page</a> ·
    <a href="https://www.npmjs.com/package/pilotkit">npm</a> ·
    <a href="https://github.com/brbousnguar/pilotkit/releases">Releases</a>
  </p>

  <p>
    <a href="#setup">Setup</a> ·
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
- **Read-only connectors, one MCP server per system.** Jira and Confluence Cloud come first: `pilotkit-atlassian`, eight tools that read with the user's own account, so they see what the user could see in a browser and cannot change a ticket or a page. Each system someone adds is its own server, so Copilot only carries the tools of the systems their job needs.
- **The desk**, a chat page on `127.0.0.1`. It runs Copilot through the official [GitHub Copilot SDK](https://github.com/github/copilot-sdk), records each model call with the credits Copilot reports for it, and shows the cost under every answer, per day and per model.
- **Brand packs**: the public package is neutral, and a team applies its own name, logo and colour with one command, without forking.

Questions that work well: *"What are my open Jira issues, by priority?"*, *"What changed in project KEY this week, and who changed it?"*, *"Summarize KEY-123 and its last comments"*, *"Find the Confluence page about the release process and list its steps"*, *"Draft a stand-up update from my issues in progress"*.

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
3. **Copilot clients.** Runs `copilot mcp add pilotkit-atlassian -- <node> <pilotkit> mcp atlassian` and adds a `pilotkit-atlassian` server to the user `mcp.json` of VS Code and VS Code Insiders, keeping every other server (and a backup of the original file).
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

**Changing the Atlassian connection.** Anything that touches a credential runs in the terminal; the desk only shows the connection. Atlassian API tokens have an expiry date: when one expires or is revoked, `pilotkit doctor` says so and `pilotkit add atlassian --new-token` replaces it. `--email <email> --new-token` switches to another account (the previous account's token is deleted), `--site <url>` to another site. A client that already runs the server reads the new token when it restarts it.

## Run

```bash
pilotkit start            # open the desk in the browser (Ctrl+C to close it)
pilotkit start --no-open  # start it without opening a browser
pilotkit doctor           # check Node, Copilot, Atlassian and both registrations, and say what to run
pilotkit credits          # credits spent in the desk, by day and by model (--days 7)
pilotkit brand <folder>   # apply a brand pack; --reset goes back to the neutral look
pilotkit add atlassian    # connect one system and register its server (setup does this on a first run)
pilotkit remove atlassian # take one system's server out of Copilot and VS Code and delete its credentials
pilotkit unlink           # remove every pilotkit server from Copilot and VS Code and delete the credentials (--purge also deletes ~/.pilotkit)
pilotkit mcp atlassian    # a connector's MCP server on stdio: what Copilot and VS Code start
```

Once set up, the same tools work in four places:

| Where | How |
|---|---|
| The desk | `pilotkit start`, then ask on the Chat page |
| VS Code | Copilot Chat → **Agent** mode → the tools icon lists **pilotkit-atlassian**. VS Code asks once to trust and start the server. |
| Copilot CLI | `copilot`, then ask. For one question: `copilot -p "Summarize KEY-123" --allow-tool=pilotkit-atlassian` |
| GitHub Copilot app | `copilot app` opens it. If pilotkit-atlassian is not in its tool list, add an MCP server with the command `pilotkit mcp atlassian`. |

## Connectors

A connector is one system pilotkit can read, with its own MCP server named `pilotkit-<connector>`. Copilot sends the descriptions of every enabled server's tools with each request, so one server holding every system would cost more credits per question and choose tools worse as it grew (VS Code also stops at 128 tools per request). With one server per system, each person adds only what their job needs, and removes it on its own.

| Connector | Server | Reads |
|---|---|---|
| `atlassian` | `pilotkit-atlassian` | Jira and Confluence Cloud, with your API token |

`pilotkit setup` sets up the connectors this PC already has, or Atlassian on a first run. `pilotkit add <connector>` and `pilotkit remove <connector>` handle one at a time. The desk and its credits cover every connector added on this PC, and it only approves their tools.

**Upgrading from 0.2.** The server used to be registered as `pilotkit`. It keeps working, and `pilotkit doctor` points it out; `pilotkit setup` renames it `pilotkit-atlassian` in the Copilot CLI and in VS Code.

## The desk

`pilotkit start` serves a small web app on `http://127.0.0.1:8717/` with three pages:

- **Chat.** One Copilot session per chat, resumed for follow-ups, with the list of chats on the left (a drawer on phones). While Copilot works, a line says what it is doing ("Searching Jira", "Reading a Confluence page"); the answer streams in as Markdown with links to every issue and page. Above each answer, a line gives its model calls, tool calls and credits; it opens on a timeline, in order, of each model call (model, input tokens, tokens served from cache, output tokens, time, credits) and each tool call (its argument, roughly how many tokens it returned, time). The model and the credit cap for new chats are in the settings menu.
- **Credits.** The Copilot month: credits used against the monthly allowance, the pace against an even plan, today against the daily plan, credits left per day, and where the month ends at this rate. A bar per day splits this desk from the rest of the account's Copilot use, a line follows the month against the plan, and a habits section breaks the desk's own credits down by model, by chat and by prompt cache, with a few plain tips to spend less.
- **Start here.** The state of this PC: the Copilot account, then each connected system checked live (the same check as `pilotkit doctor`, with the command that fixes it), and how to use the tools in each client.

The pages follow the connectors this PC added: one chat answers from all of them, and its suggestions, examples and wording name only those systems. The desk only shows connections; anything that changes a credential runs in the terminal.

### How credits are counted

Copilot sends an `assistant.usage` event after every model call. Its `copilotUsage.totalNanoAiu` is the cost in nano AI units, and 1e9 of them make one credit. The desk stores that number per call in SQLite. When a call carries no cost, the desk estimates it from the model's published token prices (`billing.tokenPrices`) and marks it with `≈`.

Each chat has a credit cap (default 60, Copilot's minimum is 30), passed to Copilot as `sessionLimits.maxAiCredits`: Copilot stops the session when it is reached. The desk's own system message asks the model to batch tool calls, ask for few results and stop as soon as it can answer, because every call re-sends the whole conversation.

The allowance comes from `account.getQuota`. It counts every Copilot client on the account, and GitHub can take a while to update it. While it runs, the desk reads it every 10 minutes and keeps the readings, so it can split the month into days: the use before its first reading of the month is shown on that day, marked as such. Without a reading (not signed in, or an unlimited plan) the page shows this desk's own credits only.

## Tools

All eight tools are read-only (`readOnlyHint: true`) and return compact Markdown: Atlassian rich text (ADF in Jira, storage XHTML in Confluence) is turned into short text before it reaches the model, because every character a tool returns is re-sent, and billed, with each later model call.

| Tool | Arguments | Returns |
|---|---|---|
| `whoami` | none | The Atlassian site and account the tools use |
| `jira_my_issues` | `include_done?`, `max?` (1–50, default 20) | Issues assigned to the user, most recently updated first, open ones by default |
| `jira_search` | `jql`, `max?`, `nextPageToken?` | Issues matching a JQL query, with a token for the next page |
| `jira_get_issue` | `key`, `comments?` (0–20, default 5), `max_chars?` | Status, people, sprint, description, latest comments, links and sub-tasks |
| `jira_issue_history` | `key` or `jql`, `since?` (`-7d`, `-24h`, `-2w` or a date), `fields?`, `max?` (1–25 issues, default 10), `per_issue?` (default 10) | Who changed what and when, newest first: one line per change (field: from → to), and for a query the number of changes per person. Jira returns the latest 100 changes per issue |
| `jira_list_projects` | `query?` | Projects the user can see, with their keys |
| `confluence_search` | `query?` or `cql?`, `space?`, `max?` (1–25) | Pages and blog posts: title, space, last update, link and an excerpt |
| `confluence_get_page` | `page` (id or link), `max_chars?` | A page as text |

`jira_issue_history` reads Jira's changelog through the same `GET` searches (`expand=changelog`), so one call answers *who changed what* for up to 25 issues.

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

`name` and `logo` (an `.svg` or `.png` next to `brand.json`, 512 KB at most) are required. `welcome` is optional: without it the desk names the systems this PC connected. `atlassianSite` pre-fills the site question in setup; `links` (https only, six at most) appear under the welcome text. The pack is checked and copied into `~/.pilotkit/brand`. See [`examples/brand-acme`](examples/brand-acme) for a complete, fictional one.

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
| Connectors added on this PC | `connectors` in `~/.pilotkit/config.json` |
| Copilot CLI registration | `~/.copilot/mcp-config.json`, through `copilot mcp add`: one `pilotkit-<connector>` entry per connector |
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
bin/pilotkit.mjs        the CLI: setup, add, remove, start, doctor, credits, brand, unlink, mcp
src/
  config.mjs            ~/.pilotkit paths, config.json, site normalisation
  secrets.mjs           the token in the Keychain, DPAPI or the Secret Service
  clients.mjs           registration in the Copilot CLI and VS Code (JSONC-safe)
  brand.mjs             brand pack validation, install, load
  connectors/           the connector catalogue; each connector's setup, check, desk lines and server
  atlassian/            REST client, ADF and storage-format to text, the eight tools, the MCP server
  cli/                  setup, add and remove, doctor and unlink, credits, terminal prompts
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
| The first seven MCP tools | Verified live, including the `404` hint |
| `jira_issue_history` | Verified on 2026-10-13 against a local stand-in for Jira that returns the `changelog` shape of Jira's published API (one issue, a JQL query, the time and field filters), and in the desk: *"What changed in my open issues this week, and who changed it?"* took two tool calls and 0.15 credits. **Not yet checked against a live site** |
| Desk: new chat, streaming, follow-up in the same session, credits per call | Verified live in Chromium (desktop, 390 px and 320 px) |
| Credits page, brand pack, Host and header guards, path traversal | Verified live |
| macOS Keychain token | Verified |
| Copilot CLI registration | Verified with Copilot CLI 1.0.91 in a scratch `COPILOT_HOME` (add, replace, remove) |
| VS Code registration | Covered by tests on a JSONC `mcp.json` with other servers |
| Windows (DPAPI token, `.cmd` shims) | Verified on 2026-10-13 from PowerShell 7.6.6 with Copilot CLI 1.0.94: `npm install -g` (from GitHub `main`), setup (DPAPI token, Copilot CLI and VS Code registration) and the desk answering from Jira. VS Code Agent mode not yet checked |
| Connectors (`pilotkit-atlassian`, `add`/`remove`, the rename from 0.2's `pilotkit`) | Verified on 2026-10-13 on macOS with scratch Copilot and VS Code folders and a local stand-in for Atlassian: setup renames the old entry in both clients, the desk and `copilot --allow-tool=pilotkit-atlassian` call the tools. On Windows on 2026-10-13 (PowerShell 7.6.6, Copilot CLI 1.0.94, `npm install -g pilotkit` 0.3.0) against a real site: `doctor` flags the old name, `setup` renames it in both clients, `doctor` is clean afterwards and the desk answers |
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
