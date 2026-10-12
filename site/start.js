import { $, esc, loadShell } from './common.js';

// "Start here": a short status of this PC above the static guide.
async function main() {
  const state = await loadShell();
  const rows = [
    state.copilot.authenticated
      ? `✓ Copilot: signed in as <strong>${esc(state.copilot.login ?? 'you')}</strong>`
      : '✗ Copilot: not signed in. Run <code>pilotkit setup</code>.',
    state.atlassian.site
      ? `✓ Atlassian: <a href="${esc(state.atlassian.site)}" target="_blank" rel="noopener noreferrer">${esc(state.atlassian.site.replace('https://', ''))}</a> as ${esc(state.atlassian.email)}`
      : '✗ Atlassian: not set up. Run <code>pilotkit setup</code>.',
    `pilotkit ${esc(state.version)}`,
  ];
  $('#status').innerHTML = rows.map((r) => `<div>${r}</div>`).join('');
}

main().catch((err) => {
  $('#status').innerHTML = `<span class="note error">The desk did not answer: ${esc(err.message)}</span>`;
});
