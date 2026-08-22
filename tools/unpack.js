#!/usr/bin/env node
/**
 * Turns the Claude Design export in src/bundle.html into a plain static site
 * under site/.
 *
 * The export is a self-extracting bundle: every asset is base64 in a manifest,
 * and the page itself is a JSON-encoded template whose asset references are
 * uuids. On load it decodes all of that to blob URLs, substitutes the uuids and
 * swaps the document — roughly a megabyte of work before anything paints.
 *
 * This script does the same substitution ahead of time against real files, so
 * the browser gets markup it can render immediately and fetches assets
 * alongside it. The output is the same page; only delivery changes.
 *
 * No dependencies — plain Node, so Netlify needs no install step.
 */
'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const ROOT = path.resolve(__dirname, '..');
const SRC = path.join(ROOT, 'src');
const OUT = path.join(ROOT, 'site');

const RUNTIME_NAME = 'dc-runtime.js';
const HERO_NAME = 'hero-datacenter.jpg';
const UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g;

/* ---------------------------------------------------------------- reading */

function readBundle() {
  const raw = fs.readFileSync(path.join(SRC, 'bundle.html'), 'utf8');
  const nl = raw.includes('\r\n') ? '\r\n' : '\n';
  const lines = raw.split(nl);
  const island = (type) => {
    const i = lines.findIndex((l) => l.includes('<script type="__bundler/' + type + '">'));
    if (i < 0) throw new Error('bundle is missing the ' + type + ' island');
    return JSON.parse(lines[i + 1]);
  };
  return {
    manifest: island('manifest'),
    extResources: island('ext_resources'),
    pageOrder: island('page_order'),
    template: island('template'),
  };
}

function bytesOf(entry) {
  const raw = Buffer.from(entry.data, 'base64');
  return entry.compressed ? zlib.gunzipSync(raw) : raw;
}

/* ----------------------------------------------------------------- naming */

const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

/** foo/bar.woff2 -> foo/bar.1a2b3c4d.woff2 */
function fingerprint(rel, buf) {
  const hash = crypto.createHash('sha256').update(buf).digest('hex').slice(0, 8);
  const ext = path.extname(rel);
  return rel.slice(0, -ext.length) + '.' + hash + ext;
}

/**
 * Derive readable font filenames from the @font-face rules that reference them.
 *
 * Google's font CSS emits one rule per subset, each preceded by a comment
 * naming that subset, and several weights can share a single file. The weight
 * only goes into the name when every rule pointing at that file agrees on it —
 * otherwise the name would claim a weight the file isn't specific to.
 */
function nameFonts(template) {
  const rules = [];
  const re = /\/\*\s*([\w-]+)\s*\*\/\s*@font-face\s*\{([^}]*)\}/g;
  let m;
  while ((m = re.exec(template))) {
    const subset = m[1];
    const body = m[2];
    const pick = (prop) => {
      const hit = body.match(new RegExp(prop + '\\s*:\\s*([^;]+);'));
      return hit ? hit[1].trim() : '';
    };
    const url = body.match(/url\("([^"]+)"\)/);
    if (!url) continue;
    rules.push({
      uuid: url[1],
      subset: subset,
      family: pick('font-family').replace(/['"]/g, ''),
      weight: pick('font-weight') || '400',
      style: pick('font-style') || 'normal',
    });
  }

  const byUuid = new Map();
  for (const r of rules) {
    if (!byUuid.has(r.uuid)) byUuid.set(r.uuid, []);
    byUuid.get(r.uuid).push(r);
  }

  const names = new Map();
  const taken = new Set();
  for (const [uuid, group] of byUuid) {
    const first = group[0];
    const weights = new Set(group.map((r) => r.weight));
    const parts = [slug(first.family)];
    if (weights.size === 1) parts.push(first.weight);
    if (first.style !== 'normal') parts.push(first.style);
    parts.push(first.subset);

    let name = parts.join('-') + '.woff2';
    let n = 2;
    while (taken.has(name)) name = parts.join('-') + '-' + n++ + '.woff2';
    taken.add(name);
    names.set(uuid, 'fonts/' + name);
  }
  return names;
}

/* ---------------------------------------------------------------- copying */

function copyDir(from, to) {
  for (const entry of fs.readdirSync(from, { withFileTypes: true })) {
    const s = path.join(from, entry.name);
    const d = path.join(to, entry.name);
    if (entry.isDirectory()) {
      fs.mkdirSync(d, { recursive: true });
      copyDir(s, d);
    } else {
      fs.mkdirSync(path.dirname(d), { recursive: true });
      fs.copyFileSync(s, d);
    }
  }
}

/* ------------------------------------------------------------------ build */

function build() {
  const bundle = readBundle();
  const manifest = bundle.manifest;
  const extResources = bundle.extResources;
  const template = bundle.template;

  if (bundle.pageOrder.length) {
    throw new Error('bundle contains nested page bundles, which this unpacker does not handle');
  }

  const runtimeRef = template.match(/<script src="([0-9a-f-]{36})"><\/script>/);
  if (!runtimeRef) throw new Error('could not find the runtime script reference in the template');
  const runtimeUuid = runtimeRef[1];

  const extByUuid = new Map(extResources.map((e) => [e.uuid, e.id]));
  const fontNames = nameFonts(template);

  fs.rmSync(OUT, { recursive: true, force: true });
  fs.mkdirSync(path.join(OUT, 'assets', 'fonts'), { recursive: true });

  const paths = new Map();
  const report = [];

  for (const [uuid, entry] of Object.entries(manifest)) {
    let rel;
    if (uuid === runtimeUuid) rel = RUNTIME_NAME;
    else if (extByUuid.has(uuid)) rel = path.posix.basename(new URL(extByUuid.get(uuid)).pathname);
    else if (fontNames.has(uuid)) rel = fontNames.get(uuid);
    else if (entry.mime === 'image/jpeg') rel = HERO_NAME;
    else throw new Error('unclassified asset ' + uuid + ' (' + entry.mime + ') — refusing to guess a filename');

    const buf = bytesOf(entry);

    // Content-hash everything the markup references, so these can be cached for
    // a year without a re-export stranding visitors on a stale runtime: new
    // bytes mean a new filename, and index.html is always revalidated. The hero
    // image is deliberately exempt — src/head-meta.html points social crawlers
    // at it by a fixed URL, and a shifting og:image is worse than a short TTL.
    if (rel !== HERO_NAME) rel = fingerprint(rel, buf);

    const dest = path.join(OUT, 'assets', rel);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.writeFileSync(dest, buf);
    paths.set(uuid, '/assets/' + rel);
    report.push({ rel: rel, bytes: buf.length, mime: entry.mime });
  }

  // Substitute every uuid reference with its real path. Assets the runtime pulls
  // in itself (React) carry no uuid in the markup — they are wired up through
  // window.__resources below instead.
  let html = template;
  for (const [uuid, p] of paths) html = html.split(uuid).join(p);

  const leftover = html.match(UUID_RE);
  if (leftover) {
    throw new Error('unsubstituted uuids remain: ' + Array.from(new Set(leftover)).join(', '));
  }

  // Fonts are local now, so these preconnects only buy a pointless DNS + TLS
  // handshake against Google on every load.
  html = html.replace(/\s*<link rel="preconnect"[^>]*>/g, '');

  // The runtime resolves its CDN dependencies through this map, falling back to
  // the real unpkg URLs when an entry is missing. Defining it also suppresses
  // the runtime's "no bundle present" refetch of the page itself.
  const resourceMap = {};
  for (const e of extResources) resourceMap[e.id] = paths.get(e.uuid);

  const headExtras =
    '\n' +
    fs.readFileSync(path.join(SRC, 'head-meta.html'), 'utf8').trim() +
    '\n<script>window.__resources = ' +
    JSON.stringify(resourceMap).replace(/<\//g, '<\\/') +
    ';</script>\n';

  const headOpen = html.match(/<head[^>]*>/i);
  if (!headOpen) throw new Error('template has no <head> to inject into');
  const at = headOpen.index + headOpen[0].length;
  html = html.slice(0, at) + headExtras + html.slice(at);

  if (!/<html[^>]*\slang=/i.test(html)) html = html.replace(/<html/i, '<html lang="en"');

  fs.writeFileSync(path.join(OUT, 'index.html'), html);
  copyDir(path.join(SRC, 'static'), OUT);

  /* ---------------------------------------------------------------- report */
  const fonts = report.filter((r) => r.rel.indexOf('fonts/') === 0);
  const other = report.filter((r) => r.rel.indexOf('fonts/') !== 0);
  const latin = fonts.filter((r) => /-latin(-ext)?(-\d+)?\.[0-9a-f]{8}\.woff2$/.test(r.rel));
  const kb = (n) => (n / 1024).toFixed(0) + ' KB';
  const sum = (rows) => rows.reduce((n, r) => n + r.bytes, 0);

  console.log('unpacked ' + report.length + ' assets into site/assets');
  console.log('  ' + 'index.html'.padEnd(32) + kb(Buffer.byteLength(html)));
  other.sort((a, b) => b.bytes - a.bytes).forEach((r) => {
    console.log('  ' + r.rel.padEnd(32) + kb(r.bytes));
  });
  console.log('  ' + ('fonts/ (' + fonts.length + ' files)').padEnd(32) + kb(sum(fonts)));
  console.log('    of which latin subsets: ' + latin.length + ' files, ' + kb(sum(latin)));
  console.log('    the other ' + (fonts.length - latin.length) + ' only download if a visitor');
  console.log('    actually renders Cyrillic/Greek/Vietnamese text');
}

build();
