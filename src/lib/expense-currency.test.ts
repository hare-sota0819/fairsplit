import { describe, expect, it } from 'vitest'
import {
  defaultExpenseCurrency,
  lastFundingByPayer,
} from './expense-currency'

const now = new Date('2026-08-02T12:00:00Z')
const hoursAgo = (h: number) => new Date(now.getTime() - h * 60 * 60 * 1000)

describe('defaultExpenseCurrency', () => {
  it('follows the last expense when it is from the last 24 hours', () => {
    expect(
      defaultExpenseCurrency({
        recent: { currency: 'JPY', at: hoursAgo(3) },
        now,
        tripCurrency: 'TWD',
        settlementCurrency: 'KRW',
      }),
    ).toBe('JPY')
  })

  it('falls back to the trip currency once the last expense is older', () => {
    // Ten Tokyo expenses then a flight to Taipei: yesterday's JPY must not
    // win over today's trip default.
    expect(
      defaultExpenseCurrency({
        recent: { currency: 'JPY', at: hoursAgo(30) },
        now,
        tripCurrency: 'TWD',
        settlementCurrency: 'KRW',
      }),
    ).toBe('TWD')
  })

  it('treats exactly 24 hours as too old', () => {
    expect(
      defaultExpenseCurrency({
        recent: { currency: 'JPY', at: hoursAgo(24) },
        now,
        tripCurrency: 'TWD',
        settlementCurrency: 'KRW',
      }),
    ).toBe('TWD')
  })

  it('uses the trip currency when there is no expense at all', () => {
    expect(
      defaultExpenseCurrency({
        recent: null,
        now,
        tripCurrency: 'JPY',
        settlementCurrency: 'KRW',
      }),
    ).toBe('JPY')
  })

  it('falls all the way through to the settlement currency', () => {
    expect(
      defaultExpenseCurrency({
        recent: null,
        now,
        tripCurrency: null,
        settlementCurrency: 'KRW',
      }),
    ).toBe('KRW')
  })

  it('still follows a stale expense when no trip currency is set', () => {
    // A pre-4C group has no trip currency; the old behaviour is all there is.
    expect(
      defaultExpenseCurrency({
        recent: { currency: 'JPY', at: hoursAgo(400) },
        now,
        tripCurrency: null,
        settlementCurrency: 'KRW',
      }),
    ).toBe('KRW')
  })

  it('accepts an expense dated slightly in the future', () => {
    // Clock skew between the device that entered it and this server.
    expect(
      defaultExpenseCurrency({
        recent: { currency: 'JPY', at: new Date(now.getTime() + 60_000) },
        now,
        tripCurrency: 'TWD',
        settlementCurrency: 'KRW',
      }),
    ).toBe('JPY')
  })
})

describe('lastFundingByPayer', () => {
  it('keeps each payer\'s most recent funding source regardless of age', () => {
    expect(
      lastFundingByPayer(
        [
          {
            payerId: 'alice',
            walletId: 'wallet-1',
            timestamp: hoursAgo(21 * 24),
          },
        ],
        now,
      ),
    ).toEqual({ alice: { kind: 'WALLET', walletId: 'wallet-1' } })
  })

  it('falls back to pay-as-you-go when the last expense used no wallet', () => {
    expect(
      lastFundingByPayer(
        [{ payerId: 'alice', walletId: null, timestamp: hoursAgo(3) }],
        now,
      ),
    ).toEqual({ alice: { kind: 'PAY_AS_YOU_GO' } })
  })

  it('excludes a future-dated expense from pinning a payer\'s funding source', () => {
    expect(
      lastFundingByPayer(
        [
          {
            payerId: 'alice',
            walletId: 'wallet-1',
            timestamp: new Date('2027-01-01T00:00:00Z'),
          },
          { payerId: 'alice', walletId: null, timestamp: hoursAgo(3) },
        ],
        now,
      ),
    ).toEqual({ alice: { kind: 'PAY_AS_YOU_GO' } })
  })

  it('keeps each payer independent', () => {
    expect(
      lastFundingByPayer(
        [
          { payerId: 'alice', walletId: 'wallet-1', timestamp: hoursAgo(3) },
          { payerId: 'bob', walletId: null, timestamp: hoursAgo(2) },
        ],
        now,
      ),
    ).toEqual({
      alice: { kind: 'WALLET', walletId: 'wallet-1' },
      bob: { kind: 'PAY_AS_YOU_GO' },
    })
  })
})
