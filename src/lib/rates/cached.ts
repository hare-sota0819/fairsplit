import { prisma } from '@/lib/prisma'
import { rateFromDecimalString } from '@/lib/settlement'
import { cacheDateFor, cachePlan, utcDateString } from './cache-policy'
import { ChainedRateProvider } from './chained'
import { FrankfurterProvider } from './frankfurter'
import { FxRatesApiProvider } from './fxratesapi'
import type { RateProvider, RateQuote } from './provider'

/**
 * The live source first, the ECB daily fixing behind it — as a genuine
 * fallback for an outage AND as the second opinion that catches a
 * wrong-by-100x rate. See `chained.ts` for both rules.
 */
const provider: RateProvider = new ChainedRateProvider(
  new FxRatesApiProvider(),
  new FrankfurterProvider(),
)

/**
 * Snapshot rate for an expense timestamp, with the date it is actually for.
 *
 * An expense dated today (or later) asks the provider for its LATEST fix
 * rather than for today specifically, so the preview is never behind a
 * publication it could have had. Reuse rules live in `cache-policy.ts`.
 *
 * Returns null when the pair/date is unavailable or the provider is
 * unreachable — the caller then requires manual entry. Never throws.
 */
export async function getSnapshotRate(
  timestamp: Date,
  base: string,
  quote: string,
  now: Date = new Date(),
): Promise<RateQuote | null> {
  const requestedDate = utcDateString(timestamp)
  const today = utcDateString(now)
  const date = cacheDateFor(requestedDate, today)
  try {
    const cached = await prisma.rateCache.findUnique({
      where: { date_base_quote: { date, base, quote } },
    })
    const plan = cachePlan(
      requestedDate,
      today,
      cached && {
        rate: cached.rate.toString(),
        asOf: cached.asOf,
        fetchedAt: cached.fetchedAt,
      },
      now,
    )
    if (plan.action === 'reuse' && cached) {
      return quoteFromCache(cached)
    }
    const fetched =
      plan.action === 'fetch-dated'
        ? await provider.getRate(plan.date, base, quote)
        : await provider.getLatest(base, quote)
    if (fetched === null) {
      // Keep serving a stale entry rather than blocking entry on an outage.
      //
      // The cache is keyed by DATE, so `cached` only helps when this exact
      // day has been fetched before. On the first expense of a new day with
      // the provider down that is always a miss — and the entry was then
      // refused outright, which is how somebody abroad on bad wifi ended up
      // unable to record what they had just paid for. Reach back to the most
      // recent rate we hold for the pair instead: it is a real published
      // rate, and every screen already prints the date it is for ("rate as of
      // Jul 31"), so an older one is visible rather than silent.
      if (cached) {
        return quoteFromCache(cached)
      }
      const newest = await prisma.rateCache.findFirst({
        where: { base, quote, date: { lte: date } },
        orderBy: { date: 'desc' },
      })
      return newest ? quoteFromCache(newest) : null
    }
    // Sanity-parse before trusting it (throws on malformed/zero).
    rateFromDecimalString(fetched.rate, quote, base)
    // The source's own timestamp is what gets stored; `fetchedAt` (when we
    // called) is only ever used to age the cache entry.
    const asOfInstant = fetched.asOfInstant ?? null
    await prisma.rateCache.upsert({
      where: { date_base_quote: { date, base, quote } },
      create: {
        date,
        base,
        quote,
        rate: fetched.rate,
        asOf: fetched.asOf,
        asOfInstant,
      },
      update: {
        rate: fetched.rate,
        asOf: fetched.asOf,
        asOfInstant,
        fetchedAt: now,
      },
    })
    return fetched
  } catch {
    return null
  }
}

function quoteFromCache(cached: {
  rate: { toString(): string }
  asOf: string
  asOfInstant: string | null
}): RateQuote {
  return {
    rate: cached.rate.toString(),
    asOf: cached.asOf,
    ...(cached.asOfInstant ? { asOfInstant: cached.asOfInstant } : {}),
  }
}
