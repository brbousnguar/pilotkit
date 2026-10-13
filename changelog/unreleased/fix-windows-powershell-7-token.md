### Fixed
- Windows: setup stores the token, and the MCP server reads it, when they run from a PowerShell 7 window. Windows PowerShell no longer inherits PowerShell 7's module path, starts by full path, takes its script as plain `-Command` text instead of `-EncodedCommand`, and its errors show as text instead of CLIXML (#13)
