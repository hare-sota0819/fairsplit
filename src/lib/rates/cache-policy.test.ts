import { describe, expect, test } from 'vitest'
import {
  TODAY_TTL_MS,
  cacheDateFor,
  cachePlan,
  utcDateString,
} from './cache-policy'

const NOW = new Date('2026-08-02T10:00:00.000Z')
const TODAY = '2026-08-02'

// The real numbers from the reported defect: on Sunday 2026-08-02 the newest
// ECB fix was Friday's, 9.0093 KRW/JPY -> "100 JPY = 900.93 KRW".
const fridaysFix = (fetchedAt: Date) => ({
  rate: '9.0093',
  asOf: '2026-07-31',
  fetchedAt,
})

describe('cacheDateFor', () => {
  test('an expense dated now keys on today', () => {
    expect(cacheDateFor(TODAY, TODAY)).toBe(TODAY)
  })

  test('a future-dated expense still keys on today', () => {
    expect(cacheDateFor('2026-09-01', TODAY)).toBe(TODAY)
  })

  test('a backdated expense keys on its own date', () => {
    expect(cacheDateFor('2026-07-28', TODAY)).toBe('2026-07-28')
  })
})

describe('cachePlan', () => {
  test('nothing cached and the expense is now: ask for the latest fix', () => {
    expect(cachePlan(TODAY, TODAY, null, NOW)).toEqual({
      action: 'fetch-latest',
    })
  })

  test('nothing cached and the expense is backdated: ask for that date', () => {
    expect(cachePlan('2026-07-28', TODAY, null, NOW)).toEqual({
      action: 'fetch-dated',
      date: '2026-07-28',
    })
  })

  test("a past date's rate is final and reused forever", () => {
    const ancient = fridaysFix(new Date('2026-07-28T00:00:00.000Z'))
    expect(cachePlan('2026-07-28', TODAY, ancient, NOW)).toEqual({
      action: 'reuse',
    })
  })

  test('an entry already dated today still expires (Phase 4D-A)', () => {
    // It used to count as final and was reused for the rest of the day. The
    // live primary restamps every minute, so "dated today" proves nothing
    // about freshness — only the TTL does.
    const liveQuote = {
      rate: '9.140467827',
      asOf: TODAY,
      fetchedAt: new Date(NOW.getTime() - TODAY_TTL_MS - 1),
    }
    expect(cachePlan(TODAY, TODAY, liveQuote, NOW)).toEqual({
      action: 'fetch-latest',
    })
  })

  test('an entry for today is reused inside the TTL, whatever its date', () => {
    const freshLive = {
      rate: '9.140467827',
      asOf: TODAY,
      fetchedAt: new Date(NOW.getTime() - 30_000),
    }
    expect(cachePlan(TODAY, TODAY, freshLive, NOW)).toEqual({ action: 'reuse' })

    const freshFallback = fridaysFix(new Date(NOW.getTime() - 30_000))
    expect(cachePlan(TODAY, TODAY, freshFallback, NOW)).toEqual({
      action: 'reuse',
    })
  })

  test('a stale-dated entry for today is re-checked once the TTL lapses', () => {
    // THE ORIGINAL BUG: a fallback quote dated Friday, cached under Sunday
    // and never looked at again. It must expire so a live quote can arrive.
    const stale = fridaysFix(new Date(NOW.getTime() - TODAY_TTL_MS - 1))
    expect(cachePlan(TODAY, TODAY, stale, NOW)).toEqual({
      action: 'fetch-latest',
    })
  })

  test('the reuse window is short enough to track a live source', () => {
    expect(TODAY_TTL_MS).toBeGreaterThanOrEqual(60_000)
    expect(TODAY_TTL_MS).toBeLessThanOrEqual(5 * 60_000)
  })
})

describe('utcDateString', () => {
  test('formats the UTC calendar date', () => {
    expect(utcDateString(new Date('2026-08-02T23:59:59.999Z'))).toBe(
      '2026-08-02',
    )
  })
})
