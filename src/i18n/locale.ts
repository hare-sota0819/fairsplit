/**
 * Which language the app speaks, and how that is decided.
 *
 * The rule that matters: **language belongs to the account, not the device.**
 * The owner runs three different OS languages across their laptop, tablet and
 * phone, so honouring the browser would show one person three different apps.
 * `Accept-Language` therefore only ever seeds a browser that has never been
 * used here, and can never beat a stored choice.
 *
 * Resolution order, highest first:
 *   1. the `fairsplit:locale` cookie — the account's locale, written at
 *      sign-in, or an explicit choice made in account settings;
 *   2. `Accept-Language`, on a genuinely first visit;
 *   3. Korean.
 */

export const LOCALES = ['ko', 'en'] as const

export type Locale = (typeof LOCALES)[number]

export const DEFAULT_LOCALE: Locale = 'ko'

export const LOCALE_COOKIE = 'fairsplit:locale'

/** A year: the cookie is a preference, not a session. */
export const LOCALE_COOKIE_MAX_AGE = 60 * 60 * 24 * 365

export function isLocale(value: unknown): value is Locale {
  return (
    typeof value === 'string' && (LOCALES as readonly string[]).includes(value)
  )
}

/**
 * The best supported match for an `Accept-Language` header, or null.
 *
 * Deliberately simple: take the entries in q-order and return the first whose
 * primary subtag we support, so `ko-KR` matches `ko` and `ja,en;q=0.8` matches
 * `en`. Anything unsupported yields null and the caller falls back.
 */
export function localeFromAcceptLanguage(header: string | null): Locale | null {
  if (!header) {
    return null
  }
  const ranked = header
    .split(',')
    .map((part) => {
      const [tag, ...params] = part.trim().split(';')
      const quality = params
        .map((p) => /^\s*q=([\d.]+)\s*$/.exec(p))
        .find(Boolean)
      return { tag: tag.trim().toLowerCase(), q: quality ? Number(quality[1]) : 1 }
    })
    .filter((entry) => entry.tag !== '' && !Number.isNaN(entry.q))
    .sort((a, b) => b.q - a.q)

  for (const { tag } of ranked) {
    const primary = tag.split('-')[0]
    if (isLocale(primary)) {
      return primary
    }
  }
  return null
}
