// Google Analytics 4 gating - the SINGLE place the measurement ID is read and
// validated.
//
// This used to be derived twice (once from `process.env` in astro.config.mjs
// to emit the gtag scripts, once from `import.meta.env` in Footer.astro to
// decide whether to render the consent banner). Those two sources are NOT
// equivalent: Astro copies `.env` values into `process.env` only at the Vite
// plugin's `buildStart`, i.e. AFTER astro.config.mjs has already evaluated. A
// `.env`-only configuration therefore produced a banner soliciting consent for
// analytics that were never loaded - and, because the consent cookie is shared
// on `.openlinker.io`, silently pre-consented the visitor on the marketing
// site. Everything GA-related now flows through this one function, so the two
// halves cannot disagree.

/** GA4 measurement IDs look like `G-XXXXXXXXXX`. */
const GA_ID_PATTERN = /^G-[A-Z0-9]+$/;

/** The only host that is allowed to emit analytics. */
const PRODUCTION_HOSTNAME = 'docs.openlinker.io';

/**
 * Resolve the measurement ID to use for this build, or `''` when analytics
 * must stay off.
 *
 * Note this gates on the BUILD-TIME `SITE_URL` (via `Astro.site`), not on the
 * host actually serving the page: a production-built image previewed on
 * localhost still carries GA. That is intentional (a static nginx build has no
 * runtime env), but it means `SITE_URL` is the switch, not the browser's
 * address bar.
 *
 * Throws on a malformed ID so a bad repo variable fails the build loudly
 * instead of emitting broken inline JavaScript.
 */
export function resolveGaId(siteHostname: string | undefined): string {
  const raw = String(import.meta.env.PUBLIC_GA_MEASUREMENT_ID ?? '').trim();
  if (!raw) return '';
  if (!GA_ID_PATTERN.test(raw)) {
    throw new Error(
      `PUBLIC_GA_MEASUREMENT_ID is not a valid GA4 measurement ID: ${JSON.stringify(raw)} ` +
        `(expected ${GA_ID_PATTERN}). Fix the repo variable / build arg, or leave it empty to disable analytics.`,
    );
  }
  return siteHostname === PRODUCTION_HOSTNAME ? raw : '';
}
