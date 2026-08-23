import { describe, expect, test } from 'vitest'
import { rateChipCopy } from './rate-chip'

/** Stands in for next-intl: echoes the key and its values. */
const t = (key: string, values?: Record<string, string | number>): string =>
  values === undefined
    ? key
    : `${key}(${Object.entries(values)
        .map(([name, value]) => `${name}=${value}`)
        .join(',')})`

describe('rateChipCopy', () => {
  test('a live wallet conversion names the wallet', () => {
    expect(
      rateChipCopy({ source: 'WALLET_AVG_COST', walletLabel: 'Cash' }, t),
    ).toEqual({
      label: 'withLabel(label=Cash)',
      explanation: 'explain.WALLET_AVG_COST',
    })
  })

  test('a fallback keeps the wallet label out of the label', () => {
    expect(
      rateChipCopy({ source: 'MARKET_FALLBACK', walletLabel: 'Cash' }, t),
    ).toEqual({
      label: 'MARKET_FALLBACK',
      explanation: 'explain.MARKET_FALLBACK',
    })
  })

  test('a frozen conversion says frozen, and still names the rate that applied', () => {
    expect(
      rateChipCopy(
        { source: 'WALLET_AVG_COST', walletLabel: 'Cash', frozen: true },
        t,
      ),
    ).toEqual({
      label: 'FROZEN',
      explanation:
        'explain.FROZEN frozenOriginal(source=withLabel(label=Cash))',
    })
  })
})
