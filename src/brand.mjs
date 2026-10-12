import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { extname, join, resolve } from 'node:path';
import { PKG_DIR, paths } from './config.mjs';

// A brand pack is a folder (or a URL) with a brand.json and a logo. The public package ships
// neutral; a team applies its own name, logo and colour at setup with --brand, so a company's
// marks never have to live in this repository. See examples/brand-acme.

export const DEFAULT_BRAND = {
  name: 'pilotkit',
  product: 'pilotkit desk',
  accent: '#a4471f',
  welcome: 'Ask about your Jira tickets and Confluence pages. Every answer shows the AI credits it cost.',
  atlassianSite: null,
  links: [],
  logoFile: join(PKG_DIR, 'site', 'pilotkit.svg'),
};

const LOGO_TYPES = { '.svg': 'image/svg+xml', '.png': 'image/png' };
const MAX_LOGO = 512 * 1024;

export function validateBrand(raw) {
  const errors = [];
  const str = (v, max) => (typeof v === 'string' && v.trim() && v.length <= max ? v.trim() : null);
  const brand = {
    name: str(raw?.name, 40),
    product: str(raw?.product, 60),
    accent: /^#[0-9a-f]{6}$/i.test(raw?.accent ?? '') ? raw.accent : null,
    welcome: str(raw?.welcome, 300),
    atlassianSite: str(raw?.atlassianSite, 200),
    logo: str(raw?.logo, 100),
    links: Array.isArray(raw?.links) ? raw.links.slice(0, 6).filter((l) => str(l?.label, 40) && /^https:\/\//.test(l?.url ?? ''))
      .map((l) => ({ label: l.label.trim(), url: l.url })) : [],
  };
  if (!brand.name) errors.push('"name" is required (40 characters at most)');
  if (raw?.accent && !brand.accent) errors.push('"accent" must be a colour like #1a2b3c');
  if (!brand.logo) errors.push('"logo" is required: the file name of an .svg or .png next to brand.json');
  else if (!LOGO_TYPES[extname(brand.logo).toLowerCase()] || /[\\/]|\.\./.test(brand.logo)) {
    errors.push('"logo" must be a plain .svg or .png file name, without a folder');
  }
  if (errors.length) throw new Error(`brand.json: ${errors.join('; ')}`);
  return brand;
}

async function fetchBytes(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url} answered ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}

/** Reads a brand pack from a folder, a brand.json path or an https URL, checks it, and copies it into ~/.pilotkit/brand. */
export async function installBrand(source) {
  let raw;
  let logo;
  if (/^https:\/\//i.test(source)) {
    const jsonUrl = source.endsWith('.json') ? source : `${source.replace(/\/?$/, '/')}brand.json`;
    raw = JSON.parse((await fetchBytes(jsonUrl)).toString('utf8'));
    const brand = validateBrand(raw);
    logo = await fetchBytes(new URL(brand.logo, jsonUrl));
  } else {
    const file = source.endsWith('.json') ? resolve(source) : join(resolve(source), 'brand.json');
    if (!existsSync(file)) throw new Error(`no brand.json at ${file}`);
    raw = JSON.parse(readFileSync(file, 'utf8'));
    const brand = validateBrand(raw);
    const logoPath = join(resolve(file, '..'), brand.logo);
    if (!existsSync(logoPath)) throw new Error(`the logo ${brand.logo} is not next to brand.json`);
    logo = readFileSync(logoPath);
  }
  const brand = validateBrand(raw);
  if (logo.length > MAX_LOGO) throw new Error(`the logo is ${Math.round(logo.length / 1024)} KB; keep it under 512 KB`);
  const ext = extname(brand.logo).toLowerCase();
  if (ext === '.svg' && !/<svg[\s>]/i.test(logo.toString('utf8'))) throw new Error('the .svg logo does not contain an <svg> element');
  if (ext === '.png' && logo.subarray(1, 4).toString('latin1') !== 'PNG') throw new Error('the .png logo is not a PNG image');
  rmSync(paths.brand, { recursive: true, force: true });
  mkdirSync(paths.brand, { recursive: true });
  const saved = { ...brand, logo: `logo${ext}` };
  writeFileSync(join(paths.brand, 'brand.json'), JSON.stringify(saved, null, 2) + '\n');
  writeFileSync(join(paths.brand, saved.logo), logo);
  return loadBrand();
}

export function removeBrand() {
  rmSync(paths.brand, { recursive: true, force: true });
}

export function loadBrand() {
  const file = join(paths.brand, 'brand.json');
  if (!existsSync(file)) return { ...DEFAULT_BRAND, custom: false };
  try {
    const b = validateBrand(JSON.parse(readFileSync(file, 'utf8')));
    return {
      ...DEFAULT_BRAND,
      ...Object.fromEntries(Object.entries(b).filter(([, v]) => v != null)),
      product: b.product ?? `${b.name} Copilot desk`,
      logoFile: join(paths.brand, b.logo),
      custom: true,
    };
  } catch {
    return { ...DEFAULT_BRAND, custom: false };
  }
}

export const logoType = (file) => LOGO_TYPES[extname(file).toLowerCase()] ?? 'application/octet-stream';
