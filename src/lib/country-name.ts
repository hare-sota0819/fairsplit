/**
 * A country's name in the reader's own language.
 *
 * `src/lib/destinations.ts` carries English names only, and asking a Korean
 * reader "JPY 쓰는 곳으로 가시나요?" — literally "heading somewhere that uses
 * JPY?" — is not something anyone says. Korean names the country: 일본.
 *
 * `Intl.DisplayNames` is the right source rather than a table of our own:
 * it ships with the runtime, covers every language the app might add, and
 * cannot drift out of date the way a hand-maintained list does.
 */
export function countryName(code: string, locale: string): string | null {
  if (!/^[A-Za-z]{2}$/.test(code)) {
    return null
  }
  try {
    // `fallback: 'none'` so an unrecognised code comes back undefined rather
    // than echoing itself: a country name of "QQ" would be no better than the
    // sentence this exists to replace.
    const name = new Intl.DisplayNames([locale], {
      type: 'region',
      fallback: 'none',
    }).of(code.toUpperCase())
    return name ?? null
  } catch {
    return null
  }
}
