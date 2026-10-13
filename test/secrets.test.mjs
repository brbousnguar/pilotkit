import assert from 'node:assert/strict';
import { test } from 'node:test';
import { plainPowershellError, powershellCommand } from '../src/secrets.mjs';

test('powershellCommand: Windows PowerShell by full path, plain -Command, no inherited PSModulePath', () => {
  const env = {
    SystemRoot: 'C:\\Windows',
    PSModulePath: 'C:\\Users\\me\\Documents\\PowerShell\\Modules;C:\\Program Files\\PowerShell\\7\\Modules',
    Path: 'C:\\Windows\\system32',
  };
  const { cmd, args, env: childEnv } = powershellCommand('Get-Date', env);
  assert.equal(cmd, 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe');
  assert.deepEqual(args, ['-NoProfile', '-NonInteractive', '-OutputFormat', 'Text', '-Command', 'Get-Date']);
  assert.ok(!args.includes('-EncodedCommand'));
  assert.deepEqual(childEnv, { SystemRoot: 'C:\\Windows', Path: 'C:\\Windows\\system32' });
});

test('powershellCommand drops PSModulePath whatever its case, and falls back to C:\\Windows', () => {
  const { cmd, env } = powershellCommand('x', { PSMODULEPATH: 'a', psmodulepath: 'b', TEMP: 't' });
  assert.equal(cmd, 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe');
  assert.deepEqual(env, { TEMP: 't' });
});

test('plainPowershellError turns CLIXML into its text and leaves plain text alone', () => {
  const clixml = '#< CLIXML\r\n<Objs Version="1.1.0.1" xmlns="http://schemas.microsoft.com/powershell/2004/04">'
    + '<S S="Error">ConvertTo-SecureString : the module &quot;x&quot; could not be loaded._x000D__x000A_</S>'
    + '<S S="Error">At line:1 char:40_x000D__x000A_</S></Objs>';
  assert.equal(plainPowershellError(clixml), 'ConvertTo-SecureString : the module "x" could not be loaded.\nAt line:1 char:40');
  assert.equal(plainPowershellError('  Access is denied.\r\n'), 'Access is denied.');
  assert.equal(plainPowershellError(''), '');
});
