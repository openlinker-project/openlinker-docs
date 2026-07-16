import { defineRouteMiddleware } from '@astrojs/starlight/route-data';

// Point the header logo / site-title at the marketing site instead of the docs
// root. The docs live on a subdomain (docs.openlinker.io) that Google treats as
// a largely separate site, so a followed cross-link back to openlinker.io is the
// main way authority flows home. See issue #4 (reciprocal SEO links).
//
// Starlight has no `logo.href` config, so we override the route-data field the
// default SiteTitle anchor reads (siteTitleHref) rather than reimplementing the
// logo markup — this stays correct across Starlight upgrades.
export const onRequest = defineRouteMiddleware((context) => {
  context.locals.starlightRoute.siteTitleHref = 'https://openlinker.io/';
});
