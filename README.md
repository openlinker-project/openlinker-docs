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

Build-time variables (`SITE_URL`, `DOCS_SOURCE_REF`, `GITHUB_TOKEN`,
`PUBLIC_GA_MEASUREMENT_ID`) can be set in a local `.env` - see `.env.example`.
Shell exports and Docker build args always take precedence over that file.

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

## Analytics

`PUBLIC_GA_MEASUREMENT_ID` (repo variable, per environment) enables Google
Analytics 4. This is a **static** build (no Node process at runtime), so the ID
must be a build arg, not just a runtime env var; empty/unset means GA stays off.

GA is additionally gated on the **configured `SITE_URL`** resolving to
`docs.openlinker.io`. That is a build-time check, not a runtime one: an image
built for production and previewed on `localhost:8080` still carries GA.

Analytics run in **basic consent mode** - `gtag.js` is not in the document at
all until the visitor accepts, so nothing (not even a cookieless collect ping)
reaches Google before that. The measurement ID, the loader, the consent cookie
and the banner all live in `src/components/Footer.astro`;
`astro.config.mjs` emits nothing GA-related.

### Cross-site consent cookie (`ol_consent`)

The visitor's analytics choice is stored in one cookie shared by
`openlinker.io` and `docs.openlinker.io`, so answering the banner on one host
does not re-prompt on the other. The contract is implemented here in
`src/lib/consent.ts` and **duplicated by hand** in the `openlinker-website`
repo (documented there in `DEPLOYMENT.md`). Every field below is load-bearing:

| Field | Value |
|---|---|
| name | `ol_consent` |
| values | exactly `v1:accepted` or `v1:rejected` - nothing else is valid |
| version | the `v1:` prefix; bump it to force a re-prompt when the set of consent categories changes |
| `Domain` | `.openlinker.io` when the host is `openlinker.io` or a `*.openlinker.io` subdomain; host-only everywhere else (local dev, previews) |
| `Path` | `/` |
| `Max-Age` | `31536000` (12 months) |
| `SameSite` | `Lax` |
| `Secure` | set whenever the page is served over https |

Invariants:

- **Readers must validate against the two values above** and treat anything
  else (empty, stale, truncated, unknown version) as *unanswered*, i.e. show
  the banner. Treating "not null" as answered produces a state where analytics
  are denied *and* the banner is hidden, with no way for the visitor to recover.
- Withdrawal must stay as easy as granting (GDPR Art. 7(3)) - the
  "Cookie preferences" control in the footer reopens the banner whenever GA is
  enabled, and rejecting expires every `_ga*` cookie.
- **Any change to this contract is a coordinated change across both repos.**
  Nothing in either build fails if they drift; it surfaces as a visitor being
  re-prompted forever, or as a stale value silently reading as unanswered.

## License

Apache-2.0. Documentation content © the OpenLinker project.
