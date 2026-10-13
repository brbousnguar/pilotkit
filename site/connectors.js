// What the desk pages say about each connector. The server lists the connectors this PC added
// (/api/state); everything a page shows about one of them comes from here.

export const CONNECTOR_UI = {
  atlassian: {
    reads: ['Jira', 'Confluence'],
    short: ['Jira', 'Confluence'],
    long: ['your Jira issues', 'Confluence pages'],
    suggestions: [
      ['What are my open Jira issues, by priority?', 'Status, priority and due date in one table', true],
      ['What changed in my open issues this week, and who changed it?', 'Who moved what, newest first', true],
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
      jira_issue_history: (a) => `Reading the history of ${a.key ?? 'Jira issues'}`,
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
  salesforce: {
    reads: ['Salesforce'],
    short: ['Salesforce'],
    long: ['Salesforce records'],
    suggestions: [
      ['Which Salesforce orgs can I read?', 'Alias, user, type and the default org', true],
      ['Show the 10 most recently changed opportunities', 'Name, stage, amount, close date and owner', true],
      ['Describe the Account object', 'Its fields, lookups and picklist values', true],
      ['Find the Salesforce records about ', 'Type a name: accounts, contacts, opportunities', false],
      ['Which custom objects does the org have?', 'Their API names, to ask about one of them', true],
      ['How many open cases are there, by priority?', 'One count per priority', true],
    ],
    activity: {
      salesforce_orgs: () => 'Checking your Salesforce orgs',
      salesforce_query: (a) => (a.tooling ? 'Querying Salesforce metadata' : 'Querying Salesforce'),
      salesforce_search: () => 'Searching Salesforce',
      salesforce_describe: (a) => `Describing ${a.object ?? 'a Salesforce object'}`,
      salesforce_list_objects: () => 'Listing the Salesforce objects',
      salesforce_get_record: (a) => `Reading a Salesforce ${a.object ?? 'record'}`,
    },
    examples: [
      'Which opportunities close this quarter, by stage and amount?',
      'Show the open cases of the account Acme, newest first.',
      'Describe the Opportunity object: which fields are required, and which are picklists?',
      'Which Apex classes changed in the last 7 days, and who changed them? (Tooling API)',
      'Draft a follow-up email for the opportunity Acme renewal. (pilotkit only reads: you send it yourself.)',
    ],
    cliExample: 'Which opportunities close this month?',
    vscodeExample: 'Use pilotkit to list the opportunities that close this month.',
    rules: [
      'It reads Salesforce with your own login in the Salesforce CLI (sf), and only the orgs you picked: you see what your Salesforce user can see, nothing more.',
      'pilotkit keeps no Salesforce password or token: the sf CLI keeps its logins, and queries go to it in a file, never through a shell.',
    ],
    fixes: '<code>sf org login web --alias &lt;name&gt;</code> logs an org in again when its login expired; <code>pilotkit add salesforce</code> changes which orgs pilotkit may read.',
  },
};

// A connector this version of the pages does not know yet still gets plain wording.
const plain = (c) => ({
  reads: [c.title], short: [c.title], long: [c.title], suggestions: [], activity: {}, examples: [], cliExample: null, vscodeExample: null, rules: [], fixes: '',
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
