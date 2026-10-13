import assert from 'node:assert/strict';
import { test } from 'node:test';
import { COMPOSE_FILE, composeCommands, containerArgs, findEngine } from '../src/cli/container.mjs';

test('each action is one or two compose commands on the packaged file', () => {
  const base = ['compose', '-f', COMPOSE_FILE, '-p', 'pilotkit'];
  assert.match(COMPOSE_FILE, /docker[\\/]compose\.yaml$/);
  assert.deepEqual(composeCommands('up'), [[...base, 'up', '-d', '--build', 'desk']]);
  assert.deepEqual(composeCommands('setup', ['--site', 'acme.atlassian.net']), [
    [...base, 'build', 'desk'],
    [...base, 'run', '--rm', 'desk', 'pilotkit', 'setup', '--site', 'acme.atlassian.net'],
  ]);
  assert.deepEqual(composeCommands('run', ['credits', '--days', '7']), [[...base, 'run', '--rm', 'desk', 'pilotkit', 'credits', '--days', '7']]);
  assert.deepEqual(composeCommands('logs', ['-f']), [[...base, 'logs', '--tail', '200', '-f']]);
  assert.equal(composeCommands('rm'), undefined);
});

test('--port and --no-open belong to up; the rest passes through', () => {
  assert.deepEqual(containerArgs(['up', '--port', '9000', '--no-open']), { action: 'up', rest: [], port: 9000, open: false });
  assert.deepEqual(containerArgs(['run', 'start', '--port', '9000']), { action: 'run', rest: ['start', '--port', '9000'], port: undefined, open: true });
  assert.throws(() => containerArgs(['up', '--port', 'x']), /port number/);
});

test('Docker first, Podman when there is no Docker', () => {
  assert.equal(findEngine(() => true), 'docker');
  assert.equal(findEngine((c) => c === 'podman'), 'podman');
  assert.equal(findEngine(() => false), null);
});
