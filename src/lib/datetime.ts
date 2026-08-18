/**
 * Wall-clock <-> instant conversion for the device's timezone.
 *
 * Phase 3C bug: the expense form's default "when" was built on the SERVER
 * with `new Date().getHours()`, so a Vercel box in UTC offered 07:41 to a
 * user standing in Seoul at 16:41 — and the submitted `datetime-local`
 * string was then re-parsed with the server's offset too. Both directions
 * have to use the offset the BROWSER reports, so both live here and take it
 * as an argument (which also makes them testable in any timezone).
 *
 * `offsetMinutes` follows `Date#getTimezoneOffset()`: minutes WEST of UTC,
 * so KST (UTC+9) is -540.
 */

const pad = (n: number): string => String(n).padStart(2, '0')

const INPUT_PATTERN = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/

/** An instant → the "YYYY-MM-DDTHH:mm" a `datetime-local` input expects. */
export function toLocalInputValue(
  instant: Date,
  offsetMinutes: number,
): string {
  const shifted = new Date(instant.getTime() - offsetMinutes * 60_000)
  return (
    `${shifted.getUTCFullYear()}-${pad(shifted.getUTCMonth() + 1)}-` +
    `${pad(shifted.getUTCDate())}T${pad(shifted.getUTCHours())}:` +
    `${pad(shifted.getUTCMinutes())}`
  )
}

/** The inverse: a `datetime-local` value read in that offset → the instant. */
export function fromLocalInputValue(
  value: string,
  offsetMinutes: number,
): Date | null {
  const match = INPUT_PATTERN.exec(value.trim())
  if (!match) {
    return null
  }
  const [, year, month, day, hour, minute] = match
  const asUtc = Date.UTC(
    Number(year),
    Number(month) - 1,
    Number(day),
    Number(hour),
    Number(minute),
  )
  const instant = new Date(asUtc + offsetMinutes * 60_000)
  return Number.isNaN(instant.getTime()) ? null : instant
}

/** The device-local calendar day ("2026-08-01") an instant falls on. */
export function toLocalDateKey(instant: Date, offsetMinutes: number): string {
  return toLocalInputValue(instant, offsetMinutes).slice(0, 10)
}

/**
 * Human-readable local date+time for display — "Aug 1, 2026, 4:41 PM" in
 * English, "2026년 8월 1일 오후 4:41" in Korean.
 *
 * The locale is a parameter rather than a hardcoded 'en' because the app now
 * speaks both; callers read it from next-intl. Numbers and money are NOT
 * localised this way, because the two languages group and separate digits
 * identically.
 */
export function formatLocalDateTime(
  instant: Date,
  offsetMinutes: number,
  locale: string,
): string {
  const shifted = new Date(instant.getTime() - offsetMinutes * 60_000)
  return new Intl.DateTimeFormat(locale, {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'UTC',
  }).format(shifted)
}
