import { createInterface } from 'node:readline';

// Terminal helpers for setup: plain prompts, a hidden one for the token, and coloured marks
// that fall back to plain text when the output is not a terminal (or NO_COLOR is set).

const tty = process.stdout.isTTY && !process.env.NO_COLOR;
const paint = (code) => (s) => (tty ? `\x1b[${code}m${s}\x1b[0m` : String(s));
export const bold = paint('1');
export const dim = paint('2');
export const green = paint('32');
export const red = paint('31');
export const yellow = paint('33');

export const ok = (msg) => console.log(`  ${green('✓')} ${msg}`);
export const bad = (msg) => console.log(`  ${red('✗')} ${msg}`);
export const warn = (msg) => console.log(`  ${yellow('!')} ${msg}`);
export const info = (msg) => console.log(`    ${dim(msg)}`);
export const step = (n, total, title) => console.log(`\n${bold(`${n}/${total}  ${title}`)}`);

export const interactive = () => Boolean(process.stdin.isTTY);

export function ask(question, { def, hidden = false } = {}) {
  if (!interactive()) {
    if (def != null) return Promise.resolve(def);
    return Promise.reject(new Error(`"${question}" needs an answer, but this is not an interactive terminal. Pass it as an option.`));
  }
  return new Promise((resolve) => {
    const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    const prompt = `  ${question}${def ? dim(` [${def}]`) : ''}: `;
    let muted = false;
    if (hidden) {
      rl._writeToOutput = (s) => {
        if (!muted) rl.output.write(s);
        else if (/\r|\n/.test(s)) rl.output.write('\n');
      };
    }
    rl.question(prompt, (answer) => {
      rl.close();
      resolve(answer.trim() || def || '');
    });
    muted = hidden;
  });
}

export async function confirm(question, def = true) {
  if (!interactive()) return def;
  const answer = (await ask(`${question} ${dim(def ? '(Y/n)' : '(y/N)')}`)).toLowerCase();
  if (!answer) return def;
  return answer.startsWith('y') || answer.startsWith('o');
}
