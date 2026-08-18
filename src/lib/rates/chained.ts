import { withinTolerance } from './decimal-text'
import type { RateProvider, RateQuote } from './provider'

/**
 * The live primary, checked against a second, independent provider.
 *
 * Two separate jobs, and it matters that they are separate:
 *
 *  1. AVAILABILITY. If the primary is unreachable, times out, or answers
 *     with something unparseable, the fallback's answer is used. A stale
 *     rate labelled with its real date beats blocking expense entry.
 *  2. PLAUSIBILITY. A rate that is wrong by 100x has reached this project
 *     before (Phase 3C), and it is not the kind of error a single source can
 *     catch about itself. So when both providers answer, the primary is only
 *     used if it agrees with the fallback to within `MAX_DIVERGENCE_PERCENT`.
 *
 * The threshold is deliberately loose. The two providers legitimately
 * disagree: the fallback is a daily fixing and the primary is live, and the
 * measured gap on the day this was written was 1.42% — during a fast move it
 * could be several times that and still be honest. 5% is far above any real
 * disagreement and far below a decimal-point error.
 *
 * When the fallback cannot answer at all (Frankfurter has no TWD, VND or IDR
 * — pairs the primary does serve) there is nothing to check against, so the
 * primary is used unverified rather than discarded. That is stated in the
 * result so a caller can log it.
 */

export const MAX_DIVERGENCE_PERCENT = 5

export type QuoteDecision =
  | { use: 'primary'; quote: RateQuote; verified: boolean }
  | { use: 'fallback'; quote: RateQuote; reason: 'unavailable' | 'implausible' }
  | { use: 'none' }

/**
 * Pure: which of two answers to trust. Split out from the fetching so every
 * branch is unit-tested without a network.
 */
export function decideQuote(
  primary: RateQuote | null,
  fallback: RateQuote | null,
): QuoteDecision {
  if (primary === null) {
    return fallback === null
      ? { use: 'none' }
      : { use: 'fallback', quote: fallback, reason: 'unavailable' }
  }
  if (fallback === null) {
    return { use: 'primary', quote: primary, verified: false }
  }
  return withinTolerance(primary.rate, fallback.rate, MAX_DIVERGENCE_PERCENT)
    ? { use: 'primary', quote: primary, verified: true }
    : { use: 'fallback', quote: fallback, reason: 'implausible' }
}

/** Structured so a divergence is greppable in the Vercel logs. */
export interface ChainLogEntry {
  event: 'rate-provider-divergence' | 'rate-provider-fallback'
  base: string
  quote: string
  primaryRate?: string
  fallbackRate: string
  fallbackAsOf: string
}

export class ChainedRateProvider implements RateProvider {
  constructor(
    private readonly primary: RateProvider,
    private readonly fallback: RateProvider,
    private readonly log: (entry: ChainLogEntry) => void = (entry) =>
      console.warn(JSON.stringify(entry)),
  ) {}

  getRate(
    date: string,
    base: string,
    quote: string,
  ): Promise<RateQuote | null> {
    return this.resolve(
      base,
      quote,
      () => this.primary.getRate(date, base, quote),
      () => this.fallback.getRate(date, base, quote),
    )
  }

  getLatest(base: string, quote: string): Promise<RateQuote | null> {
    return this.resolve(
      base,
      quote,
      () => this.primary.getLatest(base, quote),
      () => this.fallback.getLatest(base, quote),
    )
  }

  /**
   * Both providers are asked concurrently rather than the fallback only on
   * failure: the plausibility check needs the second answer on the happy
   * path too, and serialising it would put the fallback's latency on top of
   * the primary's on every miss.
   */
  private async resolve(
    base: string,
    quote: string,
    askPrimary: () => Promise<RateQuote | null>,
    askFallback: () => Promise<RateQuote | null>,
  ): Promise<RateQuote | null> {
    const [primary, fallback] = await Promise.all([
      askPrimary().catch(() => null),
      askFallback().catch(() => null),
    ])
    const decision = decideQuote(primary, fallback)
    if (decision.use === 'none') {
      return null
    }
    if (decision.use === 'fallback') {
      this.log({
        event:
          decision.reason === 'implausible'
            ? 'rate-provider-divergence'
            : 'rate-provider-fallback',
        base,
        quote,
        ...(primary ? { primaryRate: primary.rate } : {}),
        fallbackRate: decision.quote.rate,
        fallbackAsOf: decision.quote.asOf,
      })
    }
    return decision.quote
  }
}
