// Minimal .env loader, shared by astro.config.mjs and scripts/sync-docs.mjs.
//
// Why this exists: this repo reads SITE_URL, DOCS_SOURCE_REF and GITHUB_TOKEN
// through bare `process.env`, in two separate Node processes (`pnpm build` is
// `node scripts/sync-docs.mjs && astro build`). Astro's own dotenv handling
// covers neither: it populates `import.meta.env` inside the Vite pipeline, and
// copies values into `process.env` only at the Vite plugin's `buildStart` -
// after astro.config.mjs has already evaluated, and never for the standalone
// sync script. Without this, `.env.example` was a file that documented four
// variables of which copying it to `.env` configured effectively none.
//
// Importing this module for its side effect populates process.env from `.env`
// if that file exists. There is no dotenv dependency and no need for one.
//
// PRECEDENCE: a variable already present in the environment always wins, so
// shell exports and `docker build --build-arg` (which the Dockerfile turns
// into ENV) are never overridden by a stray .env left in the working tree.
// `.env` is gitignored and dockerignored.

import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const ENV_FILE = fileURLToPath(new URL('../.env', import.meta.url));

/** Strip one layer of matching quotes, the way dotenv does. */
function unquote(value) {
  const trimmed = value.trim();
  if (trimmed.length >= 2) {
    const first = trimmed[0];
    const last = trimmed[trimmed.length - 1];
    if ((first === '"' && last === '"') || (first === "'" && last === "'")) {
      return trimmed.slice(1, -1);
    }
  }
  // Unquoted values may carry a trailing `# comment`.
  return trimmed.replace(/\s+#.*$/, '').trim();
}

export function loadDotEnv(file = ENV_FILE) {
  if (!existsSync(file)) return;

  for (const rawLine of readFileSync(file, 'utf8').split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;

    const eq = line.indexOf('=');
    if (eq < 1) continue;

    const key = line.slice(0, eq).trim().replace(/^export\s+/, '');
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) continue;
    if (process.env[key] !== undefined) continue;

    process.env[key] = unquote(line.slice(eq + 1));
  }
}

loadDotEnv();
