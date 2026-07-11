# OpenLinker Docs

The documentation site for **OpenLinker** — [docs.openlinker.io](https://docs.openlinker.io).
Built with [Astro](https://astro.build) + [Starlight](https://starlight.astro.build).

This repo holds the **presentation layer only**. The documentation *content*
lives in the product repo, [`openlinker-project/openlinker`](https://github.com/openlinker-project/openlinker),
under `docs/`. This site pulls an allowlisted subset of that content at build
time and renders it — it never stores its own copy.

## How it works

```
openlinker/docs/*.md  ──(build-time fetch)──▶  scripts/sync-docs.mjs  ──▶  src/content/docs/*.md  ──▶  Starlight build
   (source of truth)        allowlist + frontmatter synthesis + link rewrite      (gitignored)            static site
```

- **`scripts/sync-docs.mjs`** fetches each file listed in its `SOURCES`
  allowlist from `openlinker-project/openlinker@main`, synthesises Starlight
  frontmatter (`title` from the first H1, `description` from the first
  paragraph), rewrites intra-doc links to site routes and everything else back
  to the product repo, and writes the result into `src/content/docs/`.
- Generated `*.md` are **gitignored** — only the hand-authored `index.mdx`
  landing page is committed. Every build reflects the product repo's current
  `main`, so there is no stored copy to drift.
- **Allowlist, not denylist:** a new internal doc added upstream is never
  published here unless it is explicitly added to `SOURCES` (and the sidebar in
  `astro.config.mjs`).

### What's published

Start-here (getting started, demo, capabilities) · the full user guide ·
adapter-authoring (plugin author guide, public API, connections & adapter
resolution) · architecture overview · webhooks · migrations.

Internal/contributor docs (engineering standards, code-review guide, testing
guides, ADRs, plans, specs, `ai-coding-assistant`, frontend internals) are
**intentionally excluded**.

## Keeping docs up to date

Rebuilds are triggered three ways (see `.github/workflows/deploy.yml`):

1. **On product release** — the product repo's release workflow fires a
   `repository_dispatch` (`product-release`); this repo listens for it.
   > ⚠️ Requires a one-line addition to the product repo's release workflow to
   > also target `openlinker-project/openlinker-docs`. Tracked as an issue on
   > the product repo — until merged, layers 2–3 keep the docs fresh.
2. **Daily schedule** — a `cron` rebuild against product `main`, so doc edits
   that land between releases propagate within ~24h.
3. **On push to this repo's `main`** — theme, sidebar, or pipeline changes.

Optional tighter coupling: a path-filtered `docs-source-changed` dispatch from
the product repo on any push touching `docs/**` (near-instant; this repo
already listens for that event type).

## Local development

```bash
pnpm install
pnpm dev      # runs sync-docs then starts the dev server
pnpm build    # runs sync-docs then builds the static site to dist/
pnpm sync     # just refresh the content from the product repo
```

`DOCS_SOURCE_REF=<branch>` builds against a non-`main` product ref (handy for
previewing docs changes before they merge).

## Deployment

Docker + reverse proxy, mirroring the marketing site's setup
(`build-on-host, no registry`). The multi-stage `Dockerfile` builds the static
site and serves it with nginx.

| Env | Host | Port |
|---|---|---|
| prod | `docs.openlinker.io` | `:8082` |
| dev | `dev.docs.openlinker.io` | `:8083` |

The deploy job is gated by the `DEPLOY_ENABLED` repo variable and needs
`SITE_URL` + `PROJECT_DIR` repo variables set per environment, plus a
self-hosted runner labelled `main` / `develop` — same as `openlinker-website`.

## License

Apache-2.0. Documentation content © the OpenLinker project.
