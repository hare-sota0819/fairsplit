/**
 * When a cached quote may be reused, and what to ask the provider for.
 *
 * Phase 4A bug: the app quoted 100 JPY = 900.93 KRW while Google said
 * 916.53. Two causes, both here:
 *
 *  1. We always asked for a DATE-SPECIFIC rate. A daily fixing exists on
 *     business days only, so a request for a Saturday, Sunday or holiday is
 *     answered with the previous business day's — up to three days old
 *     during a fast move. Asking for `latest` when the expense is "now" is
 *     the same value on a business day and strictly fresher otherwise.
 *  2. We cached under the REQUESTED date and never looked again, freezing a
 *     morning quote in for the rest of the day.
 *
 * So: a past date is final and cached forever, while a quote for "now" is
 * only ever reused inside a short TTL.
 *
 * Phase 4D-A note. There used to be a third rule — a cached quote whose
 * `asOf` was already today counted as FINAL and was reused with no TTL at
 * all. That was correct for a once-a-day fixing and is wrong for the live
 * primary, whose answer is stamped today from the first call of the morning
 * and keeps moving all day. It is gone; freshness is the TTL's job alone.
 *
 * Pure — no clock, no I/O — so every branch is unit-tested.
 */

export interface CachedQuote {
  rate: string
  /** The date the cached rate is actually for. */
  asOf: string
  fetchedAt: Date
}

/**
 * How long a quote for "now" may be reused.
 *
 * Phase 4D-A shortened this from 30 minutes and removed the rule that a
 * quote already dated today was FINAL. Both only made sense against a daily
 * fixing: once the ECB had published for the day there was genuinely nothing
 * newer to fetch. The live primary restamps every 60 seconds, so "dated
 * today" says nothing about freshness and an entry that is never re-checked
 * would freeze the morning's rate in for the rest of the day — the same
 * defect in a new place.
 *
 * Two minutes is the trade: at typical JPY/KRW volatility the displayed rate
 * stays within about 0.02% of live, while one currency pair costs at most 30
 * fetches an hour against a limit of 61 a minute.
 */
export const TODAY_TTL_MS = 2 * 60 * 1000

export type CachePlan =
  | { action: 'reuse' }
  | { action: 'fetch-latest' }
  | { action: 'fetch-dated'; date: string }

/** YYYY-MM-DD compares correctly as a plain string. */
const isCurrent = (requestedDate: string, today: string): boolean =>
  requestedDate >= today

/** The cache key for a request: "now" always keys on today. */
export function cacheDateFor(requestedDate: string, today: string): string {
  return isCurrent(requestedDate, today) ? today : requestedDate
}

export function cachePlan(
  requestedDate: string,
  today: string,
  cached: CachedQuote | null,
  now: Date,
): CachePlan {
  const current = isCurrent(requestedDate, today)
  if (cached !== null) {
    if (!current) {
      // A past date's fix never changes, and a weekend will never grow one
      // of its own, so whatever we stored is the final answer.
      return { action: 'reuse' }
    }
    if (now.getTime() - cached.fetchedAt.getTime() < TODAY_TTL_MS) {
      return { action: 'reuse' }
    }
  }
  return current
    ? { action: 'fetch-latest' }
    : { action: 'fetch-dated', date: requestedDate }
}

/** The UTC calendar date of an instant, as the provider spells dates. */
export function utcDateString(instant: Date): string {
  return instant.toISOString().slice(0, 10)
}
