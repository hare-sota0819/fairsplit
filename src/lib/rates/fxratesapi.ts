import { clampDecimals, isPlainDecimal } from './decimal-text'
import type { RateProvider, RateQuote } from './provider'

/**
 * FXRatesAPI — the live primary source (Phase 4D-A).
 *
 * Why this one replaced Frankfurter/ECB as the primary. Measured by actually
 * calling every candidate on 2026-08-03 between 02:57 and 03:03 UTC, against
 * the mid-market rate at the same instant (Wise, cross-checked against the
 * Hana Bank quote Korean users see):
 *
 *   FXRatesAPI   100 JPY = 914.05 KRW, stamped 03:03:00Z   +0.03%
 *   Yahoo        100 JPY = 911.80 KRW, stamped 02:59:57Z   -0.25%  (and its
 *                own JPYKRW=X, KRWJPY=X and EUR cross disagree with each
 *                other by up to 0.15%)
 *   Frankfurter  100 JPY = 900.93 KRW, dated 2026-07-31    -1.42%
 *
 * The ECB publishes one fixing per weekday, so Frankfurter cannot be made
 * fresher by fetching it more often — that is the whole defect this replaces.
 * FXRatesAPI restamps every minute and has genuine weekend values (Sat
 * 2026-08-01 and Sun 2026-08-02 came back stamped on those days, where the
 * ECB has only Friday's fix).
 *
 * CROSS, NOT A DIRECT PAIR — and why that is still sound here. `base` is
 * arbitrary, but internally the answer is a USD cross: on 2026-08-03T03:03Z
 * `USD->KRW 1430.4651476594 / USD->JPY 156.4980233702` = 9.140468, exactly
 * the 9.140467827 the direct `base=JPY` call returned. What makes it safe is
 * that every leg of one response carries ONE timestamp — the `date` field is
 * the snapshot instant for the whole payload — so the two legs can never be
 * sampled minutes apart the way an EUR cross assembled from separate calls
 * can. Never assemble a pair from two responses, and never from two
 * providers.
 *
 * No API key. The response advertises its own limit in `x-ratelimit-limit`
 * (61, observed); this app fetches at most once per currency pair per cache
 * window, so it is nowhere near it.
 */

const DEFAULT_BASE_URL = 'https://api.fxratesapi.com'
const TIMEOUT_MS = 4000

/** DB column is `Decimal(24, 10)`, so a stored rate may not exceed 10 places. */
const MAX_STORAGE_DECIMALS = 10

/**
 * Pull the `"QUOTE": <number>` literal straight out of the raw body so the
 * rate never round-trips through a JS float. Exponent and signed literals
 * are refused: they are not a shape this provider emits, and silently
 * mis-parsing one would be a wrong rate rather than a missing one.
 */
export function extractRateLiteral(body: string, quote: string): string | null {
  const match = body.match(
    new RegExp(`"${quote}"\\s*:\\s*(-?\\d+(?:\\.\\d+)?(?:[eE][+-]?\\d+)?)`),
  )
  if (!match) {
    return null
  }
  const literal = match[1]
  return isPlainDecimal(literal)
    ? clampDecimals(literal, MAX_STORAGE_DECIMALS)
    : null
}

/**
 * The instant the provider says the snapshot is for, e.g.
 * `"date":"2026-08-03T03:03:00.000Z"`. This is the source's own timestamp,
 * which is what gets cached — not the moment we happened to call.
 */
export function extractQuoteInstant(body: string): string | null {
  const match = body.match(
    /"date"\s*:\s*"(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z)"/,
  )
  return match ? match[1] : null
}

/** Parse one response body into a quote, or null if it is unusable. */
export function parseQuote(body: string, quote: string): RateQuote | null {
  // `"success":false` bodies carry no rates at all, but check anyway: an
  // error shape that happened to contain the quote code would otherwise be
  // scraped for a number that means something else.
  if (/"success"\s*:\s*false/.test(body)) {
    return null
  }
  const rate = extractRateLiteral(body, quote)
  const instant = extractQuoteInstant(body)
  if (rate === null || instant === null) {
    return null
  }
  return { rate, asOf: instant.slice(0, 10), asOfInstant: instant }
}

export class FxRatesApiProvider implements RateProvider {
  constructor(
    private readonly baseUrl: string = process.env.FXRATESAPI_BASE_URL ||
      DEFAULT_BASE_URL,
  ) {}

  getRate(
    date: string,
    base: string,
    quote: string,
  ): Promise<RateQuote | null> {
    return this.fetchQuote(
      `historical?date=${encodeURIComponent(date)}`,
      base,
      quote,
    )
  }

  getLatest(base: string, quote: string): Promise<RateQuote | null> {
    return this.fetchQuote('latest', base, quote)
  }

  private async fetchQuote(
    path: string,
    base: string,
    quote: string,
  ): Promise<RateQuote | null> {
    const separator = path.includes('?') ? '&' : '?'
    try {
      const response = await fetch(
        `${this.baseUrl}/${path}${separator}base=${base}&currencies=${quote}`,
        { signal: AbortSignal.timeout(TIMEOUT_MS) },
      )
      if (!response.ok) {
        return null
      }
      return parseQuote(await response.text(), quote)
    } catch {
      return null // network failure/timeout -> the caller falls back
    }
  }
}
