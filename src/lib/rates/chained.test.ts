import { describe, expect, it, vi } from 'vitest'
import { ChainedRateProvider, decideQuote } from './chained'
import type { RateProvider, RateQuote } from './provider'

const live: RateQuote = {
  rate: '9.140467827',
  asOf: '2026-08-03',
  asOfInstant: '2026-08-03T03:03:00.000Z',
}
const ecb: RateQuote = { rate: '9.0093', asOf: '2026-07-31' }

/** A provider that answers with whatever it is handed. */
const stub = (
  latest: RateQuote | null,
  dated: RateQuote | null = latest,
): RateProvider => ({
  getLatest: () => Promise.resolve(latest),
  getRate: () => Promise.resolve(dated),
})

const throwing = (): RateProvider => ({
  getLatest: () => Promise.reject(new Error('boom')),
  getRate: () => Promise.reject(new Error('boom')),
})

describe('decideQuote', () => {
  it('uses the primary when both agree', () => {
    expect(decideQuote(live, ecb)).toEqual({
      use: 'primary',
      quote: live,
      verified: true,
    })
  })

  it('uses the primary unverified when the fallback has no answer', () => {
    // Frankfurter has no TWD/VND/IDR; the primary does.
    expect(decideQuote(live, null)).toEqual({
      use: 'primary',
      quote: live,
      verified: false,
    })
  })

  it('falls back when the primary is unreachable', () => {
    expect(decideQuote(null, ecb)).toEqual({
      use: 'fallback',
      quote: ecb,
      reason: 'unavailable',
    })
  })

  it('falls back when the primary is implausible', () => {
    const hundredX: RateQuote = { ...live, rate: '914.0467827' }
    expect(decideQuote(hundredX, ecb)).toEqual({
      use: 'fallback',
      quote: ecb,
      reason: 'implausible',
    })
  })

  it('gives up only when neither answers', () => {
    expect(decideQuote(null, null)).toEqual({ use: 'none' })
  })
})

describe('ChainedRateProvider', () => {
  it('returns the live quote, timestamp intact, and logs nothing', () => {
    const log = vi.fn()
    const chain = new ChainedRateProvider(stub(live), stub(ecb), log)
    return chain.getLatest('JPY', 'KRW').then((quote) => {
      expect(quote).toEqual(live)
      expect(quote?.asOfInstant).toBe('2026-08-03T03:03:00.000Z')
      expect(log).not.toHaveBeenCalled()
    })
  })

  it('serves the fallback when the primary is unreachable, and logs it', async () => {
    const log = vi.fn()
    const chain = new ChainedRateProvider(stub(null), stub(ecb), log)
    expect(await chain.getLatest('JPY', 'KRW')).toEqual(ecb)
    expect(log).toHaveBeenCalledWith({
      event: 'rate-provider-fallback',
      base: 'JPY',
      quote: 'KRW',
      fallbackRate: '9.0093',
      fallbackAsOf: '2026-07-31',
    })
  })

  it('survives a primary that throws rather than returning null', async () => {
    const log = vi.fn()
    const chain = new ChainedRateProvider(throwing(), stub(ecb), log)
    expect(await chain.getLatest('JPY', 'KRW')).toEqual(ecb)
  })

  it('refuses a 100x primary and names both rates in the log', async () => {
    const log = vi.fn()
    const hundredX: RateQuote = { ...live, rate: '914.0467827' }
    const chain = new ChainedRateProvider(stub(hundredX), stub(ecb), log)
    expect(await chain.getLatest('JPY', 'KRW')).toEqual(ecb)
    expect(log).toHaveBeenCalledWith({
      event: 'rate-provider-divergence',
      base: 'JPY',
      quote: 'KRW',
      primaryRate: '914.0467827',
      fallbackRate: '9.0093',
      fallbackAsOf: '2026-07-31',
    })
  })

  it('keeps the primary when the fallback cannot serve the pair', async () => {
    const log = vi.fn()
    const chain = new ChainedRateProvider(stub(live), stub(null), log)
    expect(await chain.getLatest('KRW', 'VND')).toEqual(live)
    expect(log).not.toHaveBeenCalled()
  })

  it('returns null only when both are down', async () => {
    const chain = new ChainedRateProvider(stub(null), stub(null), vi.fn())
    expect(await chain.getLatest('JPY', 'KRW')).toBeNull()
  })

  it('applies the same rules to a dated request', async () => {
    const chain = new ChainedRateProvider(stub(null, null), stub(ecb), vi.fn())
    expect(await chain.getRate('2026-07-31', 'JPY', 'KRW')).toEqual(ecb)
  })

  it('asks both providers concurrently', async () => {
    const order: string[] = []
    const slow = (name: string, ms: number): RateProvider => ({
      getLatest: () =>
        new Promise((resolve) =>
          setTimeout(() => {
            order.push(name)
            resolve(live)
          }, ms),
        ),
      getRate: () => Promise.resolve(live),
    })
    const chain = new ChainedRateProvider(slow('primary', 30), slow('fb', 5))
    await chain.getLatest('JPY', 'KRW')
    // Serialised, the fallback could only finish after the primary.
    expect(order).toEqual(['fb', 'primary'])
  })
})
