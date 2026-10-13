### Added
- Connectors: each system pilotkit reads is its own MCP server, `pilotkit-<connector>`, registered on its own, so Copilot only carries the tools of the systems a user added. `pilotkit add <connector>` and `pilotkit remove <connector>` handle one at a time, and `pilotkit mcp <connector>` runs one server. The desk and its credits cover every added connector (#17)

### Changed
- Jira and Confluence are the `atlassian` connector, and their server is named `pilotkit-atlassian` instead of `pilotkit`. A 0.2 registration keeps working; `pilotkit doctor` points it out and `pilotkit setup` renames it in the Copilot CLI and VS Code. `pilotkit unlink` removes every pilotkit server (#17)
