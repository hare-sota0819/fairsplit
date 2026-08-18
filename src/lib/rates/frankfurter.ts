import type { RateProvider, RateQuote } from './provider'

// Free, keyless. Config'd base URL so a future self-hosted Frankfurter
// (Docker) is a one-env swap — nothing else changes.
const DEFAULT_BASE_URL = 'https://api.frankfurter.dev/v1'
const TIMEOUT_MS = 4000

/**
 * Extract the `"QUOTE": <number>` literal from the raw response body so the
 * rate never round-trips through a JS float. Exponent literals are refused
 * (never seen from Frankfurter; defensive).
 */
export function extractRateLiteral(body: string, quote: string): string | null {
  const match = body.match(
    new RegExp(`"${quote}"\\s*:\\s*(-?\\d+(?:\\.\\d+)?(?:[eE][+-]?\\d+)?)`),
  )
  if (!match) return null
  const literal = match[1]
  if (
    literal.includes('e') ||
    literal.includes('E') ||
    literal.startsWith('-')
  ) {
    return null
  }
  return literal
}

/**
 * The date the answer is actually for. Frankfurter echoes it as
 * `"date":"YYYY-MM-DD"`, and it differs from the requested date on every
 * weekend and public holiday — which is the whole reason we read it.
 */
export function extractQuoteDate(body: string): string | null {
  const match = body.match(/"date"\s*:\s*"(\d{4}-\d{2}-\d{2})"/)
  return match ? match[1] : null
}

/** Parse one Frankfurter body into a quote, or null if it is unusable. */
export function parseQuote(body: string, quote: string): RateQuote | null {
  const rate = extractRateLiteral(body, quote)
  const asOf = extractQuoteDate(body)
  return rate === null || asOf === null ? null : { rate, asOf }
}

export class FrankfurterProvider implements RateProvider {
  constructor(
    private readonly baseUrl: string = process.env.FRANKFURTER_BASE_URL ||
      DEFAULT_BASE_URL,
  ) {}

  getRate(
    date: string,
    base: string,
    quote: string,
  ): Promise<RateQuote | null> {
    return this.fetchQuote(date, base, quote)
  }

  getLatest(base: string, quote: string): Promise<RateQuote | null> {
    return this.fetchQuote('latest', base, quote)
  }

  private async fetchQuote(
    path: string,
    base: string,
    quote: string,
  ): Promise<RateQuote | null> {
    try {
      const response = await fetch(
        `${this.baseUrl}/${path}?base=${base}&symbols=${quote}`,
        { signal: AbortSignal.timeout(TIMEOUT_MS) },
      )
      if (!response.ok) return null
      return parseQuote(await response.text(), quote)
    } catch {
      return null // network failure/timeout -> caller falls back to manual
    }
  }
}
