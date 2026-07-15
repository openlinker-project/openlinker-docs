// Build-time content pipeline for docs.openlinker.io.
//
// Pulls an ALLOWLISTED subset of Markdown from the product repo
// (openlinker-project/openlinker @ main) and writes Starlight pages into
// src/content/docs/. Nothing is committed — the generated *.md files are
// gitignored — so the docs site never stores a copy that can drift: every
// build reflects product `main` as of build time.
//
// Mirrors the marketing site's changelog pipeline (src/lib/releases.ts):
// fetch at build, degrade loudly, single source of truth stays upstream.
//
// Design notes:
//   * ALLOWLIST, not denylist — a new internal doc upstream never leaks here
//     by default. Only files listed in SOURCES are ever published.
//   * Frontmatter (title/description) is SYNTHESISED from each doc's first H1
//     + first paragraph, so we never have to edit the product repo.
//   * Relative links/images are rewritten: intra-doc links → site routes,
//     everything else → absolute github.com / raw.githubusercontent URLs.
//   * If ZERO docs are written the script exits non-zero, so a broken fetch
//     fails the deploy (docker compose keeps the last good container) rather
//     than silently shipping an empty docs site.

import { mkdir, writeFile, readdir, rm, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import posix from 'node:path/posix';
import { fileURLToPath } from 'node:url';

const REPO = 'openlinker-project/openlinker';
const BRANCH = process.env.DOCS_SOURCE_REF ?? 'main';
const RAW = `https://raw.githubusercontent.com/${REPO}/${BRANCH}`;
const BLOB = `https://github.com/${REPO}/blob/${BRANCH}`;
const EDIT = `https://github.com/${REPO}/edit/${BRANCH}`;

const OUT_DIR = fileURLToPath(new URL('../src/content/docs', import.meta.url));

// Canonical site URL — used to build absolute links in llms.txt. Mirrors the
// default in astro.config.mjs; override with SITE_URL for the dev image.
const SITE = (process.env.SITE_URL ?? 'https://docs.openlinker.io').replace(/\/$/, '');

// llms.txt lands in public/ so Astro copies it to the site root (/llms.txt).
// Like the generated *.md pages it is gitignored — rebuilt from SOURCES every
// build, so it can never drift from what's actually published.
const LLMS_OUT = fileURLToPath(new URL('../public/llms.txt', import.meta.url));

// Section grouping for llms.txt. Order + labels mirror the hand-authored
// sidebar in astro.config.mjs; within a section, pages keep their SOURCES
// (reading) order. Any slug matching none of these falls into a trailing
// "More" section rather than being silently dropped.
const LLMS_SECTIONS = [
  { label: 'Start here', match: (s) => ['getting-started', 'demo-setup', 'capabilities'].includes(s) },
  { label: 'User guide', match: (s) => s.startsWith('user-guide/') },
  {
    label: 'Build adapters',
    match: (s) => ['plugin-author-guide', 'public-api', 'connections-and-adapter-resolution'].includes(s),
  },
  { label: 'Integrations', match: (s) => s.startsWith('integrations/') },
  { label: 'Architecture', match: (s) => s === 'architecture-overview' },
  { label: 'Operate', match: (s) => s.startsWith('webhooks/') || s === 'migrations' },
];

// The published set. `src` is repo-relative; `slug` is the docs-site route.
// Keep in sync with the hand-authored sidebar in astro.config.mjs.
//
// Optional per-entry overrides (use sparingly, only when synthesis is wrong):
//   title:       overrides the first-H1 title
//   description: overrides the first-paragraph meta description
// These win over the source doc's own frontmatter and over synthesis, so we
// can correct a bad auto-summary here without editing the product repo.
const SOURCES = [
  // Start here
  { src: 'docs/getting-started.md', slug: 'getting-started' },
  { src: 'docs/one-command-demo-setup-guide.md', slug: 'demo-setup' },
  { src: 'docs/capabilities.md', slug: 'capabilities' },
  // User guide
  { src: 'docs/user-guide/01-overview.md', slug: 'user-guide/overview' },
  { src: 'docs/user-guide/02-connecting-a-platform.md', slug: 'user-guide/connecting-a-platform' },
  { src: 'docs/user-guide/03-catalog-and-inventory.md', slug: 'user-guide/catalog-and-inventory' },
  { src: 'docs/user-guide/04-invoices.md', slug: 'user-guide/invoices' },
  { src: 'docs/user-guide/05-listings.md', slug: 'user-guide/listings' },
  { src: 'docs/user-guide/06-orders.md', slug: 'user-guide/orders' },
  { src: 'docs/user-guide/07-diagnostics.md', slug: 'user-guide/diagnostics' },
  { src: 'docs/user-guide/08-settings-and-admin.md', slug: 'user-guide/settings-and-admin' },
  // Build adapters
  { src: 'docs/plugin-author-guide.md', slug: 'plugin-author-guide' },
  { src: 'PUBLIC_API.md', slug: 'public-api' },
  { src: 'docs/connections-and-adapter-resolution.md', slug: 'connections-and-adapter-resolution' },
  // Architecture
  {
    src: 'docs/architecture-overview.md',
    slug: 'architecture-overview',
    // Synthesis grabs "…designed to be:" (lead sentence runs into a bullet
    // list), which dangles as a meta description — override with a real one.
    description:
      "OpenLinker's hexagonal (ports-and-adapters) architecture: how the framework-free domain, capability ports, and pluggable adapters fit together.",
  },
  // Integrations — per-adapter setup guides (one per live integration).
  // These live under libs/integrations/<name>/docs/ in the product repo.
  { src: 'libs/integrations/prestashop/docs/setup-guide.md', slug: 'integrations/prestashop' },
  { src: 'libs/integrations/woocommerce/docs/setup-guide.md', slug: 'integrations/woocommerce' },
  { src: 'libs/integrations/allegro/docs/setup-guide.md', slug: 'integrations/allegro' },
  { src: 'libs/integrations/erli/docs/setup-guide.md', slug: 'integrations/erli' },
  { src: 'libs/integrations/inpost/docs/setup-guide.md', slug: 'integrations/inpost' },
  { src: 'libs/integrations/dpd-polska/docs/setup-guide.md', slug: 'integrations/dpd' },
  { src: 'libs/integrations/ksef/docs/setup-guide.md', slug: 'integrations/ksef' },
  { src: 'libs/integrations/subiekt/docs/setup-guide.md', slug: 'integrations/subiekt' },

  // Operate
  { src: 'docs/webhooks/overview.md', slug: 'webhooks/overview' },
  { src: 'docs/webhooks/prestashop.md', slug: 'webhooks/prestashop' },
  { src: 'docs/migrations.md', slug: 'migrations' },
];

const slugBySrc = new Map(SOURCES.map((s) => [normalize(s.src), s.slug]));

function normalize(p) {
  return posix.normalize(p).replace(/^\.\//, '');
}

// ---------- Frontmatter + text helpers ----------

// Minimal leading-frontmatter stripper (title/description only, if present).
function stripFrontmatter(content) {
  const m = content.match(/^﻿?---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
  if (!m) return { data: {}, body: content.replace(/^﻿/, '') };
  const data = {};
  for (const line of m[1].split(/\r?\n/)) {
    const kv = line.match(/^(title|description):\s*['"]?(.*?)['"]?\s*$/);
    if (kv) data[kv[1]] = kv[2];
  }
  return { data, body: content.slice(m[0].length) };
}

function extractTitle(body) {
  const m = body.match(/^#\s+(.+?)\s*#*\s*$/m);
  if (!m) return { title: null, body };
  const title = m[1].trim();
  // Remove that first H1 line — Starlight renders the frontmatter title as H1.
  const body2 = body.slice(0, m.index) + body.slice(m.index + m[0].length);
  return { title, body: body2.replace(/^\s*\n/, '') };
}

// Turn a chunk of markdown into a clean one-line meta description ≤ 155 chars.
function toDescription(body) {
  const lines = body.split(/\r?\n/);
  let para = '';
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) {
      if (para) break;
      continue;
    }
    // Skip headings, blockquotes, lists, tables, code fences, badges, HTML.
    if (/^(#|>|\||```|-|\*|\d+\.|<|!\[|\[!)/.test(line)) {
      if (para) break;
      continue;
    }
    para += (para ? ' ' : '') + line;
    if (para.length > 180) break;
  }
  const clean = para
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '') // images
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1') // links → text
    .replace(/[*_`]+/g, '') // emphasis / code ticks
    .replace(/<[^>]+>/g, '') // inline HTML
    .replace(/\s+/g, ' ')
    .trim();
  if (clean.length <= 155) return clean;
  const cut = clean.slice(0, 152);
  return cut.slice(0, cut.lastIndexOf(' ')).trim() + '…';
}

// ---------- Link / image rewriting ----------

function rewriteTarget(fromSrc, rawTarget, isImage = false) {
  const [target, hash = ''] = splitHash(rawTarget);
  if (!target) return rawTarget; // pure anchor (#section) — leave as-is
  if (/^(https?:|mailto:|tel:|data:|\/\/)/i.test(target)) return rawTarget; // external
  if (target.startsWith('/')) return rawTarget; // already absolute site path

  const abs = normalize(posix.join(posix.dirname(fromSrc), target));
  const mappedSlug = slugBySrc.get(abs);
  if (mappedSlug) return `/${mappedSlug}/${hash}`; // intra-site link

  // Not published here → point at the product repo. Images resolve to raw so
  // they embed; every other link (source files, directories, unpublished
  // docs) goes to the GitHub blob/tree UI, which handles files and dirs alike.
  const base = isImage ? RAW : BLOB;
  return `${base}/${abs}${hash}`;
}

function splitHash(t) {
  const i = t.indexOf('#');
  return i === -1 ? [t, ''] : [t.slice(0, i), t.slice(i)];
}

function rewriteLinks(body, fromSrc) {
  return (
    body
      // Markdown images: ![alt](path "title")
      .replace(/!\[([^\]]*)\]\(\s*([^)\s]+)(\s+"[^"]*")?\s*\)/g, (_m, alt, url, title = '') =>
        `![${alt}](${rewriteTarget(fromSrc, url, true)}${title})`,
      )
      // Markdown links: [text](path "title")  (not preceded by ! — that's an image)
      .replace(/(^|[^!])\[([^\]]*)\]\(\s*([^)\s]+)(\s+"[^"]*")?\s*\)/g, (_m, pre, text, url, title = '') =>
        `${pre}[${text}](${rewriteTarget(fromSrc, url)}${title})`,
      )
      // HTML <img src="path">
      .replace(/(<img\b[^>]*\bsrc=)["']([^"']+)["']/gi, (_m, pre, url) =>
        `${pre}"${rewriteTarget(fromSrc, url, true)}"`,
      )
  );
}

// ---------- Fetch + transform ----------

async function fetchRaw(src) {
  const headers = { 'User-Agent': 'openlinker-docs-sync' };
  const token = process.env.GITHUB_TOKEN;
  if (token) headers.authorization = `Bearer ${token}`;
  const res = await fetch(`${RAW}/${src}`, { headers });
  if (!res.ok) throw new Error(`GET ${src} → ${res.status}`);
  return res.text();
}

function buildPage(source, raw) {
  const { src, slug } = source;
  const { data, body: afterFm } = stripFrontmatter(raw);
  const { title: h1, body: afterTitle } = extractTitle(afterFm);
  // Precedence: explicit SOURCES override → source-doc frontmatter → synthesis
  // (first H1 / first paragraph). Overrides let us fix the odd doc whose lead
  // paragraph isn't a good summary, without touching the product repo.
  const title = source.title || data.title || h1 || slug.split('/').pop().replace(/-/g, ' ');
  const description = source.description || data.description || toDescription(afterTitle);
  const bodyOut = rewriteLinks(afterTitle, src).trim() + '\n';

  const fm = ['---', `title: ${yaml(title)}`];
  if (description) fm.push(`description: ${yaml(description)}`);
  fm.push(`editUrl: ${EDIT}/${src}`);
  fm.push('---', '', '');
  return { page: fm.join('\n') + bodyOut, title, description };
}

// JSON strings are valid YAML double-quoted scalars for plain text — safe for
// titles/descriptions that may contain colons or quotes.
function yaml(s) {
  return JSON.stringify(String(s));
}

// Remove previously generated *.md (keep hand-authored index.mdx) so a
// shrunk allowlist can't leave orphans behind.
async function cleanGenerated(dir) {
  if (!existsSync(dir)) return;
  for (const entry of await readdir(dir)) {
    const full = path.join(dir, entry);
    const s = await stat(full);
    if (s.isDirectory()) {
      await rm(full, { recursive: true, force: true });
    } else if (entry.endsWith('.md')) {
      await rm(full, { force: true });
    }
  }
}

// ---------- llms.txt ----------

// Build an /llms.txt index (see llmstxt.org) from the pages we just published,
// so LLMs get a curated, section-grouped map of the docs with one-line
// summaries — the same title/description synthesised for each page.
function buildLlmsTxt(pages) {
  const bySlug = new Map(pages.map((p) => [p.slug, p]));
  const ordered = SOURCES.map((s) => bySlug.get(s.slug)).filter(Boolean); // SOURCES/reading order

  const link = (p) => {
    const url = `${SITE}/${p.slug}/`;
    return p.description ? `- [${p.title}](${url}): ${p.description}` : `- [${p.title}](${url})`;
  };

  const out = [
    '# OpenLinker',
    '',
    '> OpenLinker is an open-source, self-hosted e-commerce orchestration platform: connect shops, marketplaces, carriers, and invoicing providers behind one pluggable, capability-based core.',
    '',
    'Documentation for OpenLinker — self-hosted · plugin-native · Apache 2.0. Pages below are single-sourced from the product repository and published on docs.openlinker.io.',
    '',
  ];

  const grouped = new Set();
  for (const { label, match } of LLMS_SECTIONS) {
    const items = ordered.filter((p) => match(p.slug));
    if (!items.length) continue;
    out.push(`## ${label}`, '');
    for (const p of items) {
      out.push(link(p));
      grouped.add(p.slug);
    }
    out.push('');
  }

  const rest = ordered.filter((p) => !grouped.has(p.slug));
  if (rest.length) {
    out.push('## More', '');
    for (const p of rest) out.push(link(p));
    out.push('');
  }

  return out.join('\n').trimEnd() + '\n';
}

async function main() {
  await mkdir(OUT_DIR, { recursive: true });
  await cleanGenerated(OUT_DIR);

  const pages = [];
  const failed = [];
  await Promise.all(
    SOURCES.map(async (source) => {
      try {
        const raw = await fetchRaw(source.src);
        const { page, title, description } = buildPage(source, raw);
        const dest = path.join(OUT_DIR, `${source.slug}.md`);
        await mkdir(path.dirname(dest), { recursive: true });
        await writeFile(dest, page, 'utf8');
        pages.push({ slug: source.slug, title, description });
      } catch (err) {
        failed.push(`${source.src}: ${err.message}`);
      }
    }),
  );

  const written = pages.length;
  console.log(`[sync-docs] wrote ${written}/${SOURCES.length} pages from ${REPO}@${BRANCH}`);
  if (failed.length) console.warn('[sync-docs] skipped:\n  ' + failed.join('\n  '));

  if (written === 0) {
    console.error('[sync-docs] no docs written — failing the build rather than shipping empty docs');
    process.exit(1);
  }

  await mkdir(path.dirname(LLMS_OUT), { recursive: true });
  await writeFile(LLMS_OUT, buildLlmsTxt(pages), 'utf8');
  console.log(`[sync-docs] wrote llms.txt (${written} pages)`);
}

main().catch((err) => {
  console.error('[sync-docs] fatal:', err);
  process.exit(1);
});
