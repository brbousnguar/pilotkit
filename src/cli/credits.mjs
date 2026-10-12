import { existsSync } from 'node:fs';
import { paths } from '../config.mjs';
import { creditsReport, openDb } from '../desk/db.mjs';
import { bold, dim } from './ui.mjs';

const fmt = (n) => (Math.round(n * 100) / 100).toFixed(2);

export function printCredits(days) {
  if (!existsSync(paths.db)) {
    console.log('No desk conversations yet: "pilotkit start" opens the desk.');
    return;
  }
  const db = openDb(paths.db);
  const r = creditsReport(db, days);
  db.close();
  console.log(`\n${bold('AI credits spent in the desk')} ${dim('(1 credit = $0.01; VS Code and the Copilot CLI are billed too, but not counted here)')}\n`);
  console.log(`  Today        ${fmt(r.today.credits).padStart(9)}  ${dim(`${r.today.calls} model calls`)}`);
  console.log(`  This month   ${fmt(r.month.credits).padStart(9)}  ${dim(`${r.month.calls} model calls`)}`);
  console.log(`  All time     ${fmt(r.total.credits).padStart(9)}  ${dim(`${r.total.calls} model calls`)}`);
  if (r.byModel.length) {
    console.log(`\n${bold(`By model, last ${days} days`)}`);
    for (const m of r.byModel) console.log(`  ${m.model.padEnd(28)} ${fmt(m.credits).padStart(9)}  ${dim(`${m.calls} calls`)}`);
  }
  if (r.byDay.length) {
    console.log(`\n${bold(`By day, last ${days} days`)}`);
    const max = Math.max(...r.byDay.map((d) => d.credits), 0.01);
    for (const d of r.byDay) console.log(`  ${d.day}  ${fmt(d.credits).padStart(8)}  ${'█'.repeat(Math.max(1, Math.round((d.credits / max) * 30)))}`);
  }
  console.log('');
}
