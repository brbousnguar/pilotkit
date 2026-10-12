import { $, esc, loadShell } from './common.js';

// "Start here": a short status of this PC above the static guide.
async function main() {
  const state = await loadShell();
  const ok = '<span class="ok">✓</span>';
  const no = '<span class="no">✗</span>';
  const rows = [
    state.copilot.authenticated
      ? `${ok} Copilot: signed in as <strong>${esc(state.copilot.login ?? 'you')}</strong>`
      : `${no} Copilot: not signed in. Run <code>pilotkit setup</code>.`,
    state.atlassian.site
      ? `${ok} Atlassian: <a href="${esc(state.atlassian.site)}" target="_blank" rel="noopener noreferrer">${esc(state.atlassian.site.replace('https://', ''))}</a> as ${esc(state.atlassian.email)}`
      : `${no} Atlassian: not set up. Run <code>pilotkit setup</code>.`,
    `<span class="muted">pilotkit ${esc(state.version)}</span>`,
  ];
  $('#status').innerHTML = rows.map((r) => `<div>${r}</div>`).join('');
}

main().catch((err) => {
  $('#status').innerHTML = `<span class="no">The desk did not answer: ${esc(err.message)}</span>`;
});
