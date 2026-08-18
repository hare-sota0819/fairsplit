import { describe, expect, test } from 'vitest'
import {
  QUOTE_UNITS,
  convertAtDisplayRate,
  deviatesBeyond,
  displayRateToStorage,
  quoteUnitFor,
  storageRateToDisplay,
} from './rate-units'
import { rateFromDecimalString } from './settlement'

describe('quoteUnitFor', () => {
  test('per-100 currencies', () => {
    expect(quoteUnitFor('JPY')).toBe(100)
    expect(quoteUnitFor('KRW')).toBe(100)
  })

  test('per-1000 currencies', () => {
    expect(quoteUnitFor('VND')).toBe(1000)
    expect(quoteUnitFor('IDR')).toBe(1000)
  })

  test('everything else quotes per 1', () => {
    expect(quoteUnitFor('USD')).toBe(1)
    expect(quoteUnitFor('EUR')).toBe(1)
    expect(quoteUnitFor('GBP')).toBe(1)
    expect(quoteUnitFor('ZZZ')).toBe(1)
  })

  test('every table entry is a power of ten (the shift is exact)', () => {
    for (const unit of Object.values(QUOTE_UNITS)) {
      expect(Number.isInteger(Math.log10(unit))).toBe(true)
    }
  })
})

describe('displayRateToStorage', () => {
  test('the Phase 3C bug: "100 JPY = 916.66 KRW" is 9.1666 per 1 JPY', () => {
    expect(displayRateToStorage('916.66', 'JPY')).toBe('9.1666')
  })

  test('per-1 currencies pass through unchanged', () => {
    expect(displayRateToStorage('1350.5', 'USD')).toBe('1350.5')
  })

  test('per-1000 currencies shift three places', () => {
    expect(displayRateToStorage('56.4', 'VND')).toBe('0.0564')
  })

  test('integers shift without a stray decimal point', () => {
    expect(displayRateToStorage('900', 'JPY')).toBe('9')
    expect(displayRateToStorage('9', 'JPY')).toBe('0.09')
  })

  test('trailing zeros are trimmed but the value is preserved', () => {
    expect(displayRateToStorage('916.6600', 'JPY')).toBe('9.1666')
  })

  test('rejects malformed input and over-precise input', () => {
    expect(displayRateToStorage('', 'JPY')).toBeNull()
    expect(displayRateToStorage('9,16', 'JPY')).toBeNull()
    expect(displayRateToStorage('-916', 'JPY')).toBeNull()
    expect(displayRateToStorage('0', 'JPY')).toBeNull()
    // 10 decimals is the DB limit; shifting by 100 adds two more.
    expect(displayRateToStorage('1.123456789', 'JPY')).toBeNull()
    expect(displayRateToStorage('1.12345678', 'JPY')).toBe('0.0112345678')
  })

  test('the storage value round-trips through the engine parser', () => {
    const stored = displayRateToStorage('916.66', 'JPY')!
    expect(rateFromDecimalString(stored, 'KRW', 'JPY')).toEqual({
      numerator: 91666n,
      denominator: 10000n,
    })
  })
})

describe('storageRateToDisplay', () => {
  test('inverts displayRateToStorage', () => {
    expect(storageRateToDisplay('9.1666', 'JPY')).toBe('916.66')
    expect(storageRateToDisplay('1350.5', 'USD')).toBe('1350.5')
    expect(storageRateToDisplay('0.0564', 'VND')).toBe('56.4')
  })

  test('renders whole results without a decimal point', () => {
    expect(storageRateToDisplay('9', 'JPY')).toBe('900')
    expect(storageRateToDisplay('9.000000', 'JPY')).toBe('900')
  })

  test('rounds long provider rates for display', () => {
    // Frankfurter-style precision, shown at 4 decimals in display units.
    expect(storageRateToDisplay('9.16663333', 'JPY')).toBe('916.6633')
  })

  test('returns null for malformed input', () => {
    expect(storageRateToDisplay('abc', 'JPY')).toBeNull()
  })
})

describe('convertAtDisplayRate', () => {
  test('50,000 JPY at 100 JPY = 916 KRW costs 458,000 KRW', () => {
    expect(convertAtDisplayRate(50_000n, '916', 'JPY', 'KRW')).toBe(458_000n)
  })

  test('handles fractional quote rates', () => {
    expect(convertAtDisplayRate(50_000n, '916.66', 'JPY', 'KRW')).toBe(458_330n)
  })

  test('handles two-decimal settlement currencies', () => {
    // 10,000 JPY at 100 JPY = 0.67 USD -> 67.00 USD -> 6700 cents.
    expect(convertAtDisplayRate(10_000n, '0.67', 'JPY', 'USD')).toBe(6_700n)
  })

  test('per-1 currencies need no shifting', () => {
    // 100.00 USD at 1 USD = 1350 KRW.
    expect(convertAtDisplayRate(10_000n, '1350', 'USD', 'KRW')).toBe(135_000n)
  })

  test('null for an unusable rate', () => {
    expect(convertAtDisplayRate(50_000n, '', 'JPY', 'KRW')).toBeNull()
    expect(convertAtDisplayRate(50_000n, '0', 'JPY', 'KRW')).toBeNull()
  })
})

describe('deviatesBeyond', () => {
  test('the 100x mistake is far beyond 30%', () => {
    expect(deviatesBeyond('916.66', '9.1666', 30)).toBe(true)
  })

  test('small differences are accepted', () => {
    expect(deviatesBeyond('9.5', '9.1666', 30)).toBe(false)
    expect(deviatesBeyond('9.1666', '9.1666', 30)).toBe(false)
  })

  test('symmetric-ish: a rate far below the reference also trips', () => {
    expect(deviatesBeyond('0.091666', '9.1666', 30)).toBe(true)
  })

  test('exactly at the threshold does not trip', () => {
    expect(deviatesBeyond('13', '10', 30)).toBe(false)
    expect(deviatesBeyond('13.01', '10', 30)).toBe(true)
  })

  test('malformed input never trips the warning', () => {
    expect(deviatesBeyond('abc', '9.1666', 30)).toBe(false)
    expect(deviatesBeyond('9.1666', '', 30)).toBe(false)
  })
})
