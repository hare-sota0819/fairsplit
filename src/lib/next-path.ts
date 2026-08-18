/**
 * The guide continues to wherever the user was originally headed, carried in
 * `?next=`. That value reaches an anchor's href, and it comes from the URL, so
 * it is attacker-controlled: `/guide?next=//evil.example` would send a
 * freshly-signed-up account off the site with our own page as the referrer.
 *
 * Only a single-slash, same-origin path survives. Everything else — absolute
 * URLs, protocol-relative `//host`, the backslash variant browsers normalise
 * to a slash, and anything empty — becomes the group list.
 */
export function safeNext(value: string | undefined): string {
  if (!value || !value.startsWith('/')) return '/'
  if (value.startsWith('//') || value.startsWith('/\\')) return '/'
  return value
}

/**
 * Auth.js's own redirect callback (the default one, which this app does not
 * override) turns any relative URL it is handed into an ABSOLUTE one —
 * `baseUrl + url` — before it round-trips through a query param. That is
 * exactly what happens to the `callbackUrl` on the `pages.newUser` redirect:
 * a first-time Google signup that started from `/join/abc` gets
 * `?callbackUrl=https://<host>/join/abc` on the way to `/guide`, and
 * `safeNext` (correctly) refuses anything that doesn't start with `/`.
 *
 * Reducing to a path first, rather than loosening `safeNext`, is what keeps
 * this open-redirect-safe: any origin — ours or an attacker's — reduces to a
 * same-origin path, because only the path/search/hash survive. A value that
 * is not a valid absolute URL (already a path, or the protocol-relative
 * `//host` form `new URL` refuses without a base) is returned unchanged and
 * still has to clear `safeNext`'s own guard afterwards.
 */
export function asPath(value: string | undefined): string | undefined {
  if (!value) return value
  try {
    const url = new URL(value)
    return `${url.pathname}${url.search}${url.hash}`
  } catch {
    return value
  }
}
