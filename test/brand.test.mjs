import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

process.env.PILOTKIT_HOME = mkdtempSync(join(tmpdir(), 'pk-home-'));
const { installBrand, loadBrand, removeBrand, validateBrand } = await import('../src/brand.mjs');
const ACME = join(dirname(fileURLToPath(import.meta.url)), '..', 'examples', 'brand-acme');

test('validateBrand: name and logo are required, the rest is checked', () => {
  assert.throws(() => validateBrand({}), /"name" is required.*"logo" is required/);
  assert.throws(() => validateBrand({ name: 'X', logo: '../logo.svg' }), /plain \.svg or \.png/);
  assert.throws(() => validateBrand({ name: 'X', logo: 'logo.gif' }), /plain \.svg or \.png/);
  assert.throws(() => validateBrand({ name: 'X', logo: 'logo.svg', accent: 'red' }), /"accent"/);
  const b = validateBrand({ name: 'X', logo: 'logo.png', links: [{ label: 'ok', url: 'https://x.test' }, { label: 'no', url: 'http://x.test' }] });
  assert.deepEqual(b.links, [{ label: 'ok', url: 'https://x.test' }]);
});

test('the neutral brand applies when no pack is installed', () => {
  removeBrand();
  const b = loadBrand();
  assert.equal(b.custom, false);
  assert.equal(b.name, 'pilotkit');
  assert.match(b.logoFile, /pilotkit\.svg$/);
});

test('installBrand copies the example pack into the pilotkit home', async () => {
  const b = await installBrand(ACME);
  assert.equal(b.custom, true);
  assert.equal(b.product, 'Acme Copilot desk');
  assert.equal(b.accent, '#c2410c');
  assert.match(b.logoFile, /brand[\\/]logo\.svg$/);
  assert.equal(loadBrand().name, 'Acme');
  removeBrand();
  assert.equal(loadBrand().custom, false);
});

test('installBrand refuses a logo that is not what it claims', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'pk-brand-'));
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'brand.json'), JSON.stringify({ name: 'Bad', logo: 'logo.svg' }));
  writeFileSync(join(dir, 'logo.svg'), 'not an svg');
  await assert.rejects(installBrand(dir), /does not contain an <svg> element/);
  await assert.rejects(installBrand(join(dir, 'missing')), /no brand\.json/);
});
