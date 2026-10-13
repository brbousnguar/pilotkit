// What the desk pages say about each connector. The server lists the connectors this PC added
// (/api/state); everything a page shows about one of them comes from here.

export const CONNECTOR_UI = {
  atlassian: {
    reads: 'Jira and Confluence',
    short: ['Jira', 'Confluence'],
    long: ['your Jira issues', 'Confluence pages'],
    suggestions: [
      ['What are my open Jira issues, by priority?', 'Status, priority and due date in one table', true],
      ['Which of my issues changed in the last 7 days?', 'What moved, newest first', true],
      ['Summarize the Jira issue ', 'Type the key: the problem, what was tried, what is left', false],
      ['Find the Confluence pages about onboarding', 'Titles, spaces and links', true],
      ['Draft a stand-up update from my issues in progress', 'Yesterday, today, blockers', true],
      ['Which Jira projects can I see?', 'Their keys, to ask about one of them', true],
    ],
    // What the assistant is doing, from the tool it is waiting on.
    activity: {
      whoami: () => 'Checking your Atlassian account',
      jira_my_issues: () => 'Loading your Jira issues',
      jira_search: () => 'Searching Jira',
      jira_get_issue: (a) => `Reading Jira ${a.key ?? 'issue'}`,
      jira_list_projects: () => 'Listing the Jira projects',
      confluence_search: () => 'Searching Confluence',
      confluence_get_page: () => 'Reading a Confluence page',
    },
    examples: [
      'What are my open Jira issues, by priority?',
      'Which issues in project KEY changed this week, and who changed them?',
      'Summarize KEY-123: the problem, what was tried, and what is still open.',
      'Find the Confluence page about the deployment process and list its steps.',
      'Draft a comment for KEY-123 asking for the missing test data. (pilotkit only reads: you paste the comment yourself.)',
    ],
    cliExample: 'Summarize the Jira issue KEY-123',
    vscodeExample: 'Use pilotkit to list my open Jira issues.',
    rules: [
      'It reads Jira and Confluence with your own Atlassian account: you see what you could see in the browser, nothing more.',
      'Your Atlassian API token stays protected on this PC: in the macOS Keychain, in a file only your Windows account can decrypt (DPAPI), or in the Linux Secret Service. Never in a config file.',
    ],
    fixes: '<code>pilotkit add atlassian --new-token</code> replaces an expired or revoked Atlassian token. Atlassian API tokens are created at <a href="https://id.atlassian.com/manage-profile/security/api-tokens" target="_blank" rel="noopener noreferrer">id.atlassian.com → Security → API tokens</a>.',
  },
};

// A connector this version of the pages does not know yet still gets plain wording.
const plain = (c) => ({
  reads: c.title, short: [c.title], long: [c.title], suggestions: [], activity: {}, examples: [], cliExample: null, vscodeExample: null, rules: [], fixes: '',
});

export const connectorsOf = (state) => state.connectors.map((c) => ({ ...c, ui: CONNECTOR_UI[c.id] ?? plain(c) }));

// "a", "a or b", "a, b or c" (and with "and").
export const joinWords = (items, last = 'or') => (items.length < 2 ? items.join('') : `${items.slice(0, -1).join(', ')} ${last} ${items.at(-1)}`);

// Up to six suggestions, shared out between the connectors.
export function suggestionsOf(connectors) {
  if (!connectors.length) return [];
  const each = Math.max(2, Math.floor(6 / connectors.length));
  return connectors.flatMap((c) => c.ui.suggestions.slice(0, each)).slice(0, 6);
}

// Every known connector's, so an old chat that used a connector removed since still reads well.
export const ACTIVITY = Object.assign({}, ...Object.values(CONNECTOR_UI).map((u) => u.activity));
