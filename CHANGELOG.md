# Changelog

All notable changes to this project are documented here.
Format based on [Keep a Changelog](https://keepachangelog.com/),
and this project adheres to [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Changed
- The desk follows the connectors this PC added: the chat's suggestions, activity lines, placeholder and settings, and the Start page's heading, examples, server names and rules, name only those systems. The Start page checks each connection live, with the command that fixes it, and shows the account's name instead of its email. A brand pack's `welcome` is optional (#25)

### Fixed
- When Atlassian refuses the token (expired or revoked), `pilotkit doctor` and the tools' errors say to run `pilotkit add atlassian --new-token` (#23)
- Switching the Atlassian email deletes the previous account's token from the Keychain or the Secret Service, and setup no longer offers to keep a token saved for another account, which on Windows it did (#23)

## [0.3.0] - 2026-10-13

### Added
- Connectors: each system pilotkit reads is its own MCP server, `pilotkit-<connector>`, registered on its own, so Copilot only carries the tools of the systems a user added. `pilotkit add <connector>` and `pilotkit remove <connector>` handle one at a time, and `pilotkit mcp <connector>` runs one server. The desk and its credits cover every added connector (#17)

### Changed
- Jira and Confluence are the `atlassian` connector, and their server is named `pilotkit-atlassian` instead of `pilotkit`. A 0.2 registration keeps working; `pilotkit doctor` points it out and `pilotkit setup` renames it in the Copilot CLI and VS Code. `pilotkit unlink` removes every pilotkit server (#17)

## [0.2.1] - 2026-10-13

### Fixed
- Windows: setup stores the token, and the MCP server reads it, when they run from a PowerShell 7 window. Windows PowerShell no longer inherits PowerShell 7's module path, starts by full path, takes its script as plain `-Command` text instead of `-EncodedCommand`, and its errors show as text instead of CLIXML (#13)

## [0.2.0] - 2026-10-12

### Added
- The desk reads the account's monthly Copilot use every 10 minutes while it runs, so the Credits page can split the month into days (#7)

### Changed
- The desk has a new look: warm paper and cut-paper colours, Fraunces and Inter served from the package (no font CDN), the chats in a sidebar (a drawer on phones), settings in a menu, a live line saying what Copilot is doing, and each answer's model and tool calls on a timeline above it. It is light only (#7)
- The Credits page follows the Copilot month: used against the allowance, pace, today against the daily plan, credits left per day and where the month ends at this rate, with a chart per day, a chart for the month and the desk's habits by model, chat and prompt cache (#7)
- A new logo: a paper plane on a tilted clay tile with a butter sun (#9)
- The default brand accent is `#a4471f` (#7)
- README header: an npm version badge, the logo by absolute URL so it shows on npm and anywhere else the README is rendered, and links to the write-up, the project page, npm and the releases (#5)

### Removed
- The desk's `/api/quota` and `/api/credits` endpoints, replaced by `/api/month`; the `pilotkit credits` terminal report is unchanged (#7)
- The desk's dark theme (#7)

## [0.1.0] - 2026-10-12

### Added
- `pilotkit setup`, `doctor`, `unlink`: connect a GitHub Copilot seat to Jira and Confluence on one PC, with the Atlassian API token in the OS credential store and the bundled MCP server registered with VS Code and the Copilot CLI (#1)
- `pilotkit mcp`: a read-only Atlassian MCP server (Jira search, issue, my issues; Confluence search, page) (#1)
- `pilotkit start`: a local desk on 127.0.0.1 that chats through the Copilot SDK and records the AI credits of every model call, per answer, per day, per model and per chat (#1)
- `pilotkit credits` and `pilotkit brand`: a terminal credit report, and brand packs that apply a company's name, logo and accent colour from a folder outside this repo (#1)

[Unreleased]: https://github.com/brbousnguar/pilotkit/compare/v0.2.0...HEAD
[0.2.0]: https://github.com/brbousnguar/pilotkit/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/brbousnguar/pilotkit/releases/tag/v0.1.0
