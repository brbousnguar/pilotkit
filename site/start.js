import { $, api, esc, loadShell } from './common.js';
import { connectorsOf, joinWords } from './connectors.js';

// "Start here": what this PC has connected, checked live, above a guide written for those systems.
const OK = '<span class="ok">✓</span>';
const NO = '<span class="no">✗</span>';
const WAIT = '<span class="muted">…</span>';

function connectorRow(c, check) {
  const where = c.link
    ? `<a href="${esc(c.link)}" target="_blank" rel="noopener noreferrer">${esc(c.where)}</a>`
    : esc(c.where ?? 'not set up');
  if (!check) return `${WAIT} ${esc(c.title)}: ${where} <span class="muted">checking…</span>`;
  if (check.ok) return `${OK} ${esc(c.title)}: ${where}${check.account ? ` as <strong>${esc(check.account)}</strong>` : ''}`;
  return `${NO} ${esc(c.title)}: ${esc(check.message)}${check.fix ? `<div class="fix">${esc(check.fix)}</div>` : ''}`;
}

function guide(connectors) {
  const reads = joinWords(connectors.map((c) => c.ui.reads), 'and');
  if (reads) {
    $('#reads').textContent = reads;
    $('#reads-lede').textContent = reads;
  }
  if (!connectors.length) return;
  const servers = connectors.map((c) => c.server);
  $('#servers').textContent = joinWords(servers, 'and');
  $('#servers-verb').textContent = servers.length > 1 ? 'are' : 'is';
  const first = connectors.find((c) => c.ui.cliExample) ?? connectors[0];
  if (first.ui.vscodeExample) $('#vscode-example').textContent = `"${first.ui.vscodeExample}"`;
  $('#cli-example').textContent = `copilot -p "${first.ui.cliExample ?? 'What can you read with pilotkit?'}" ${servers.map((s) => `--allow-tool=${s}`).join(' ')}`;
  $('#app-example').textContent = connectors.map((c) => `pilotkit mcp ${c.id}`).join(', ');
  $('#examples').innerHTML = connectors.filter((c) => c.ui.examples.length).map((c) => `
    ${connectors.length > 1 ? `<h3>${esc(c.title)}</h3>` : ''}
    <ul class="chips">${c.ui.examples.map((q) => `<li>${esc(q)}</li>`).join('')}</ul>`).join('');
  $('#rules').insertAdjacentHTML('afterbegin', connectors.flatMap((c) => c.ui.rules).map((r) => `<li>${esc(r)}</li>`).join(''));
  // The fix lines are written in connectors.js, not taken from the server.
  $('#fixes').innerHTML = connectors.map((c) => c.ui.fixes).filter(Boolean).join(' ');
}

async function main() {
  const state = await loadShell();
  const connectors = connectorsOf(state);
  guide(connectors);
  const head = [
    state.copilot.authenticated
      ? `${OK} Copilot: signed in as <strong>${esc(state.copilot.login ?? 'you')}</strong>`
      : `${NO} Copilot: not signed in. Run <code>pilotkit setup</code>.`,
  ];
  const foot = [`<span class="muted">pilotkit ${esc(state.version)}</span>`];
  const show = (rows) => { $('#status').innerHTML = [...head, ...rows, ...foot].map((r) => `<div>${r}</div>`).join(''); };
  if (!connectors.length) return show([`${NO} No system is connected yet. Run <code>pilotkit setup</code>.`]);
  show(connectors.map((c) => connectorRow(c, null)));
  const checks = await api('/api/connections').catch((err) => connectors.map(() => ({ ok: false, message: `not checked: ${err.message}` })));
  show(connectors.map((c, i) => connectorRow(c, checks.find((x) => x.id === c.id) ?? checks[i])));
}

main().catch((err) => {
  $('#status').innerHTML = `<span class="no">The desk did not answer: ${esc(err.message)}</span>`;
});
