### Added
- The desk reads the account's monthly Copilot use every 10 minutes while it runs, so the Credits page can split the month into days (#7)

### Changed
- The desk has a new look: warm paper and cut-paper colours, Fraunces and Inter served from the package (no font CDN), a new paper-plane logo, the chats in a sidebar (a drawer on phones), settings in a menu, a live line saying what Copilot is doing, and each answer's model and tool calls on a timeline above it. It is light only (#7)
- The Credits page follows the Copilot month: used against the allowance, pace, today against the daily plan, credits left per day and where the month ends at this rate, with a chart per day, a chart for the month and the desk's habits by model, chat and prompt cache (#7)
- The default brand accent is `#a4471f` (#7)

### Removed
- The desk's `/api/quota` and `/api/credits` endpoints, replaced by `/api/month`; the `pilotkit credits` terminal report is unchanged (#7)
- The desk's dark theme (#7)
