import { describe, expect, test } from 'vitest'
import { walletAdjustmentAmount, walletBalance } from './wallet'
import type { ExchangeRecordInput } from './types'

// Two top-ups onto the JPY wallet; a TWD wallet's record must not leak in.
const records: ExchangeRecordInput[] = [
  {
    walletId: 'w-jpy',
    amountPaid: 931_000n,
    amountReceived: 100_000n,
    currency: 'JPY',
  },
  {
    walletId: 'w-jpy',
    amountPaid: 460_000n,
    amountReceived: 50_000n,
    currency: 'JPY',
  },
  {
    walletId: 'w-usd',
    amountPaid: 140_000n,
    amountReceived: 100n,
    currency: 'USD',
  },
]

describe('walletBalance', () => {
  test('loaded minus spends from that wallet; refunds add back', () => {
    const spend = [
      { walletId: 'w-jpy', amount: 30_000n },
      { walletId: 'w-jpy', amount: -1_000n },
      { walletId: 'w-jpy', amount: 12_000n },
      { walletId: 'w-usd', amount: 5_000n },
    ]
    expect(walletBalance('w-jpy', records, spend).balance).toBe(109_000n)
  })

  test('no exchanges: spending drives the balance negative', () => {
    expect(
      walletBalance('w-jpy', [], [{ walletId: 'w-jpy', amount: 3_000n }])
        .balance,
    ).toBe(-3_000n)
  })
})

describe('walletAdjustmentAmount', () => {
  test('missing cash is a positive personal CASH expense', () => {
    expect(walletAdjustmentAmount(109_000n, 108_500n)).toBe(500n)
  })

  test('surplus cash is a negative one', () => {
    expect(walletAdjustmentAmount(109_000n, 110_000n)).toBe(-1_000n)
  })
})
