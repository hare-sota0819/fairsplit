import { describe, expect, test } from 'vitest'
import { computeAvgRate, walletOwnAvgRate } from './rates'
import type {
  ExchangeRecordInput,
  Rate,
  SettlementContext,
} from './types'

const marketRate: Rate = { numerator: 95n, denominator: 10n } // 9.5 KRW/JPY

describe('computeAvgRate', () => {
  test('computes the weighted average across exchange records (brief example)', () => {
    // 465,500 KRW -> 50,000 JPY then 270,900 KRW -> 30,000 JPY
    // => 736,400 / 80,000 = 9.205 KRW/JPY
    const records: ExchangeRecordInput[] = [
      {
        walletId: 'w',
        amountPaid: 465_500n,
        amountReceived: 50_000n,
        currency: 'JPY',
      },
      {
        walletId: 'w',
        amountPaid: 270_900n,
        amountReceived: 30_000n,
        currency: 'JPY',
      },
    ]
    const result = computeAvgRate(records, marketRate)
    expect(result.usedFallback).toBe(false)
    expect(result.rate).toEqual({ numerator: 736_400n, denominator: 80_000n })
  })

  test('falls back to the market rate and flags it when no records exist', () => {
    const result = computeAvgRate([], marketRate)
    expect(result.usedFallback).toBe(true)
    expect(result.rate).toEqual(marketRate)
  })
})

describe('walletOwnAvgRate', () => {
  const context = (records: ExchangeRecordInput[]): SettlementContext => ({
    settlementCurrency: 'KRW',
    walletsById: new Map([
      [
        'w',
        {
          id: 'w',
          memberId: 'm',
          type: 'CASH',
          label: 'Cash',
          currency: 'JPY',
        },
      ],
    ]),
    recordsByWallet: new Map(records.length ? [['w', records]] : []),
  })

  test('is the average cost of the top-ups, with no market rate involved', () => {
    const rate = walletOwnAvgRate(
      'w',
      context([
        {
          walletId: 'w',
          amountPaid: 931_000n,
          amountReceived: 100_000n,
          currency: 'JPY',
        },
      ]),
    )
    expect(rate).toEqual({ numerator: 931_000n, denominator: 100_000n })
  })

  test('is null with no top-ups, rather than silently borrowing the market', () => {
    // computeAvgRate answers the same question with a market fallback, which
    // is exactly what a caller with no market rate to offer cannot use.
    expect(walletOwnAvgRate('w', context([]))).toBeNull()
  })

  test('is null for an unknown wallet', () => {
    expect(walletOwnAvgRate('nope', context([]))).toBeNull()
  })
})
