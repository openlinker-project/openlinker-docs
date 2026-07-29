// Cross-site cookie-consent contract (v1).
//
// The visitor's analytics choice is stored in a single cookie shared by
// openlinker.io and docs.openlinker.io, so answering the banner on one host
// does not re-prompt on the other. The contract below is duplicated by hand
// in the openlinker-website repo (src/lib/consent.ts there); every field is
// load-bearing and any change to it is a COORDINATED change across both
// repos. The written contract lives in README.md, section "Cross-site consent
// cookie (ol_consent)".
//
//   name      ol_consent
//   values    exactly "v1:accepted" or "v1:rejected" - nothing else is valid
//   version   the "v1:" prefix; bump it to force a re-prompt when the set of
//             consent categories changes (an old value stops validating and
//             the banner shows again)
//   domain    .openlinker.io on the production hosts, host-only elsewhere
//   max-age   31536000 (12 months)
//   samesite  lax; plus Secure over https
//
// Readers MUST validate against the two values above and treat anything else
// (empty, stale, truncated, unknown version) as UNANSWERED. Treating "not
// null" as answered creates a state where analytics is denied AND the banner
// is hidden, with no way for the visitor to recover.

export const CONSENT_COOKIE_NAME = 'ol_consent';
export const CONSENT_ACCEPTED = 'v1:accepted';
export const CONSENT_REJECTED = 'v1:rejected';
/** 12 months, in seconds. */
export const CONSENT_MAX_AGE_SECONDS = 31536000;

/**
 * Browser-side implementation of the contract above, emitted verbatim into an
 * inline `<script>` (see Footer.astro). It is a string rather than a bundled
 * module because it has to run with no network round-trip, in the same
 * synchronous tick as the GA bootstrap that consumes it.
 *
 * Exposes `window.__olConsent`:
 *   read()                   -> 'v1:accepted' | 'v1:rejected' | null (unanswered)
 *   isGranted()              -> boolean
 *   write(value)             -> persists, with a sessionStorage fallback
 *   clearAnalyticsCookies()  -> expires every _ga* cookie
 *
 * Kept in ONE place so the GA bootstrap and the banner wiring cannot drift
 * apart. Byte-compatible with the openlinker-website implementation.
 */
export const consentRuntimeScript = `
(function () {
  var NAME = ${JSON.stringify(CONSENT_COOKIE_NAME)};
  var ACCEPTED = ${JSON.stringify(CONSENT_ACCEPTED)};
  var REJECTED = ${JSON.stringify(CONSENT_REJECTED)};
  var MAX_AGE = ${CONSENT_MAX_AGE_SECONDS};

  function rawCookie() {
    var parts = document.cookie.split(/;\\s*/);
    for (var i = 0; i < parts.length; i++) {
      var eq = parts[i].indexOf('=');
      if (eq > -1 && parts[i].slice(0, eq) === NAME) return parts[i].slice(eq + 1);
    }
    return null;
  }

  function fromSession() {
    try { return sessionStorage.getItem(NAME); } catch (e) { return null; }
  }

  function valid(value) {
    return value === ACCEPTED || value === REJECTED;
  }

  // Anything that is not exactly one of the two v1 values counts as
  // UNANSWERED, so the visitor always gets the banner back.
  function read() {
    var value = rawCookie();
    if (!valid(value)) value = fromSession();
    return valid(value) ? value : null;
  }

  function domainAttr() {
    var h = location.hostname;
    return h === 'openlinker.io' || h.slice(-14) === '.openlinker.io'
      ? '; domain=.openlinker.io'
      : '';
  }

  function write(value) {
    var secure = location.protocol === 'https:' ? '; secure' : '';
    document.cookie =
      NAME + '=' + value + '; path=/; max-age=' + MAX_AGE + domainAttr() + '; samesite=lax' + secure;
    // Cookies may be blocked outright. Read back, and if nothing stuck fall
    // back to sessionStorage so the dismissal at least survives the session
    // instead of re-prompting on every single page view.
    if (rawCookie() !== value) {
      try { sessionStorage.setItem(NAME, value); } catch (e) { /* nothing left to try */ }
    }
  }

  // Withdrawing consent has to remove what the consent allowed, not just stop
  // future collection: _ga / _ga_<container-id> otherwise sit on the domain
  // for their full 2-year lifetime.
  function clearAnalyticsCookies() {
    var domain = domainAttr();
    var parts = document.cookie.split(/;\\s*/);
    for (var i = 0; i < parts.length; i++) {
      var eq = parts[i].indexOf('=');
      var name = eq > -1 ? parts[i].slice(0, eq) : parts[i];
      if (/^_ga/.test(name)) {
        if (domain) document.cookie = name + '=; max-age=0; path=/' + domain;
        document.cookie = name + '=; max-age=0; path=/';
      }
    }
  }

  window.__olConsent = {
    ACCEPTED: ACCEPTED,
    REJECTED: REJECTED,
    read: read,
    isGranted: function () { return read() === ACCEPTED; },
    write: write,
    clearAnalyticsCookies: clearAnalyticsCookies,
  };
})();
`;
