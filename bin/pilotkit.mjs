#!/usr/bin/env node
import { parseArgs } from 'node:util';

// node:sqlite still prints an "experimental" warning on every start; it is not news to a user.
process.removeAllListeners('warning');
process.on('warning', (w) => {
  if (w.name === 'ExperimentalWarning' && /SQLite/i.test(w.message)) return;
  console.warn(`${w.name}: ${w.message}`);
});

const HELP = `pilotkit — GitHub Copilot with Jira and Confluence, set up in one command

Usage
  pilotkit setup [options]     sign in to Copilot, connect Atlassian, add the tools to Copilot and VS Code
  pilotkit add <connector>     connect one system and add its tools to Copilot and VS Code (atlassian)
  pilotkit remove <connector>  take one system's tools out of Copilot and VS Code and delete its credentials
  pilotkit start [--port n]    open the desk: chat about tickets and pages, with the AI credits of every answer
                               (--no-open starts it without opening a browser)
  pilotkit doctor              check every part of the setup
  pilotkit credits [--days n]  credits spent in the desk, by day and by model
  pilotkit brand [folder|url]  apply a brand pack, or show the current one; --reset goes back to neutral
  pilotkit mcp <connector>     run a connector's MCP server on stdio (what Copilot and VS Code start)
  pilotkit unlink [--purge]    remove every pilotkit server from Copilot and VS Code and delete the credentials
  pilotkit --version

Each connector is its own MCP server, pilotkit-<connector> (pilotkit-atlassian), so Copilot
carries only the tools of the systems you added.

Setup and add options
  --brand <folder|url>   apply a brand pack (brand.json + logo), e.g. your company's name and logo
  --site <url>           Atlassian site, e.g. acme.atlassian.net
  --email <email>        Atlassian account email
  --new-token            ask for a new API token even if one is saved
  --port <n>             desk port (default 8717)
  --skip-copilot         do not touch the Copilot CLI
  --skip-vscode          do not touch VS Code

The API token can also come from PILOTKIT_ATLASSIAN_TOKEN; settings live in ~/.pilotkit (PILOTKIT_HOME).
`;

async function main() {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      brand: { type: 'string' },
      site: { type: 'string' },
      email: { type: 'string' },
      'new-token': { type: 'boolean' },
      port: { type: 'string' },
      days: { type: 'string' },
      'skip-copilot': { type: 'boolean' },
      'skip-vscode': { type: 'boolean' },
      'no-open': { type: 'boolean' },
      purge: { type: 'boolean' },
      reset: { type: 'boolean' },
      version: { type: 'boolean', short: 'v' },
      help: { type: 'boolean', short: 'h' },
    },
  });
  const command = positionals[0] ?? (values.version ? 'version' : 'help');
  const port = values.port ? Number(values.port) : undefined;
  if (port !== undefined && !(Number.isInteger(port) && port > 0 && port < 65536)) throw new Error(`--port ${values.port} is not a port`);

  switch (command) {
    case 'mcp': {
      // No name: a server registered before connectors existed (0.2), which was Atlassian.
      const { findConnector } = await import('../src/connectors/index.mjs');
      return findConnector(positionals[1] ?? 'atlassian').serve();
    }
    case 'setup': {
      const { setup } = await import('../src/cli/setup.mjs');
      return setup({
        brand: values.brand, site: values.site, email: values.email, newToken: values['new-token'], port,
        skipCopilot: values['skip-copilot'], skipVscode: values['skip-vscode'],
      });
    }
    case 'add':
    case 'remove': {
      if (!positionals[1]) throw new Error(`which connector? "pilotkit ${command} atlassian"`);
      const cli = await import('../src/cli/setup.mjs');
      if (command === 'remove') {
        process.exitCode = await cli.remove(positionals[1]);
        return;
      }
      return cli.add(positionals[1], {
        site: values.site, email: values.email, newToken: values['new-token'],
        skipCopilot: values['skip-copilot'], skipVscode: values['skip-vscode'],
      });
    }
    case 'start':
    case 'desk': {
      const { startDesk } = await import('../src/desk/server.mjs');
      const desk = await startDesk({ port, open: !values['no-open'] });
      const shut = async () => {
        await desk.close();
        process.exit(0);
      };
      process.on('SIGINT', shut);
      process.on('SIGTERM', shut);
      return;
    }
    case 'doctor': {
      const { doctor } = await import('../src/cli/doctor.mjs');
      process.exitCode = await doctor();
      return;
    }
    case 'unlink': {
      const { unlink } = await import('../src/cli/doctor.mjs');
      process.exitCode = await unlink({ purge: values.purge });
      return;
    }
    case 'brand': {
      const { installBrand, loadBrand, removeBrand } = await import('../src/brand.mjs');
      if (values.reset) removeBrand();
      else if (positionals[1]) await installBrand(positionals[1]);
      const b = loadBrand();
      console.log(b.custom ? `Brand: ${b.product} (${b.name}), logo ${b.logoFile}` : 'Brand: neutral pilotkit (no brand pack applied)');
      if (values.reset || positionals[1]) console.log('Restart the desk ("pilotkit start") to see it.');
      return;
    }
    case 'credits': {
      const { printCredits } = await import('../src/cli/credits.mjs');
      return printCredits(Number(values.days) || 30);
    }
    case 'version':
    case '--version': {
      const { VERSION } = await import('../src/config.mjs');
      console.log(VERSION);
      return;
    }
    case 'help':
      console.log(HELP);
      return;
    default:
      console.error(`Unknown command "${command}".\n`);
      console.log(HELP);
      process.exitCode = 2;
  }
}

main().catch((err) => {
  console.error(`\npilotkit: ${err.message}`);
  if (process.env.PILOTKIT_DEBUG) console.error(err.stack);
  process.exit(1);
});
