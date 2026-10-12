# Changelog

All notable changes to this project are documented here.
Format based on [Keep a Changelog](https://keepachangelog.com/),
and this project adheres to [Semantic Versioning](https://semver.org/).

## [Unreleased]

## [0.1.1] - 2026-10-12

### Changed
- README header: an npm version badge, the logo by absolute URL so it shows on npm and anywhere else the README is rendered, and links to the write-up, the project page, npm and the releases (#5)

## [0.1.0] - 2026-10-12

### Added
- `pilotkit setup`, `doctor`, `unlink`: connect a GitHub Copilot seat to Jira and Confluence on one PC, with the Atlassian API token in the OS credential store and the bundled MCP server registered with VS Code and the Copilot CLI (#1)
- `pilotkit mcp`: a read-only Atlassian MCP server (Jira search, issue, my issues; Confluence search, page) (#1)
- `pilotkit start`: a local desk on 127.0.0.1 that chats through the Copilot SDK and records the AI credits of every model call, per answer, per day, per model and per chat (#1)
- `pilotkit credits` and `pilotkit brand`: a terminal credit report, and brand packs that apply a company's name, logo and accent colour from a folder outside this repo (#1)

[Unreleased]: https://github.com/brbousnguar/pilotkit/compare/v0.1.1...HEAD
[0.1.1]: https://github.com/brbousnguar/pilotkit/compare/v0.1.0...v0.1.1
[0.1.0]: https://github.com/brbousnguar/pilotkit/releases/tag/v0.1.0
