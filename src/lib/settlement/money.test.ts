import { describe, expect, test } from 'vitest'
import {
  addRatio,
  allocateLargestRemainder,
  ceilDiv,
  minorUnitDigits,
  rateFromDecimalString,
  rateToDecimalString,
  ratio,
  roundDivHalfEven,
} from './money'

describe('ratio helpers', () => {
  test('ratio normalizes to lowest terms', () => {
    expect(ratio(28n, 4n)).toEqual({ num: 7n, den: 1n })
    expect(ratio(0n, 7n)).toEqual({ num: 0n, den: 1n })
    expect(ratio(10_000n, 3n)).toEqual({ num: 10_000n, den: 3n })
  })

  test('ratio supports negative numerators (refunds), rejects bad denominators', () => {
    expect(ratio(-10_000n, 3n)).toEqual({ num: -10_000n, den: 3n })
    expect(ratio(-28n, 4n)).toEqual({ num: -7n, den: 1n })
    expect(() => ratio(1n, 0n)).toThrow()
    expect(() => ratio(1n, -3n)).toThrow()
  })

  test('addRatio adds exactly', () => {
    // 1/3 + 1/6 = 1/2
    expect(addRatio(ratio(1n, 3n), ratio(1n, 6n))).toEqual({ num: 1n, den: 2n })
    // -1/3 + 1/6 = -1/6
    expect(addRatio(ratio(-1n, 3n), ratio(1n, 6n))).toEqual({
      num: -1n,
      den: 6n,
    })
    // 3334 + 10000/3 = 20002/3
    expect(addRatio(ratio(3334n, 1n), ratio(10_000n, 3n))).toEqual({
      num: 20_002n,
      den: 3n,
    })
  })
})

describe('ceilDiv', () => {
  test('exact division returns the quotient', () => {
    expect(ceilDiv(9n, 3n)).toBe(3n)
    expect(ceilDiv(0n, 5n)).toBe(0n)
  })

  test('any remainder rounds up (payer-favored)', () => {
    expect(ceilDiv(10n, 3n)).toBe(4n)
    expect(ceilDiv(1n, 100n)).toBe(1n)
    expect(ceilDiv(9205n, 3n)).toBe(3069n)
  })

  test('negative dividends round toward zero (payer-favored on refunds)', () => {
    expect(ceilDiv(-10n, 3n)).toBe(-3n)
    expect(ceilDiv(-9n, 3n)).toBe(-3n)
    expect(ceilDiv(-1n, 100n)).toBe(0n)
  })

  test('rejects non-positive divisors', () => {
    expect(() => ceilDiv(1n, 0n)).toThrow()
    expect(() => ceilDiv(1n, -3n)).toThrow()
  })
})

describe('minorUnitDigits', () => {
  test('returns ISO 4217 exponents', () => {
    expect(minorUnitDigits('JPY')).toBe(0)
    expect(minorUnitDigits('KRW')).toBe(0)
    expect(minorUnitDigits('USD')).toBe(2)
  })

  test('throws on unknown currency code', () => {
    expect(() => minorUnitDigits('NOPE')).toThrow(/NOPE/)
  })
})

describe('roundDivHalfEven', () => {
  test('divides exactly when there is no remainder', () => {
    expect(roundDivHalfEven(10n, 2n)).toBe(5n)
  })

  test('rounds below half down and above half up', () => {
    expect(roundDivHalfEven(7n, 3n)).toBe(2n) // 2.33...
    expect(roundDivHalfEven(8n, 3n)).toBe(3n) // 2.66...
  })

  test('rounds exact halves to the even neighbor', () => {
    expect(roundDivHalfEven(5n, 2n)).toBe(2n) // 2.5 -> 2
    expect(roundDivHalfEven(7n, 2n)).toBe(4n) // 3.5 -> 4
  })

  test('is sign-correct for negative dividends', () => {
    expect(roundDivHalfEven(-5n, 2n)).toBe(-2n) // -2.5 -> -2
    expect(roundDivHalfEven(-7n, 2n)).toBe(-4n) // -3.5 -> -4
    expect(roundDivHalfEven(-7n, 3n)).toBe(-2n)
  })

  test('throws on division by zero', () => {
    expect(() => roundDivHalfEven(1n, 0n)).toThrow()
  })
})

describe('allocateLargestRemainder', () => {
  test('splits 100 three ways summing to exactly 100, deterministically', () => {
    const result = allocateLargestRemainder(100n, [1n, 1n, 1n])
    expect(result).toEqual([34n, 33n, 33n])
    expect(result.reduce((a, b) => a + b, 0n)).toBe(100n)
  })

  test('allocates proportionally to weights', () => {
    expect(allocateLargestRemainder(100n, [3n, 1n])).toEqual([75n, 25n])
  })

  test('gives remainder units to the largest fractional remainders', () => {
    // 10 over weights [1, 2, 4]: exact shares 1.428..., 2.857..., 5.714...
    // floors [1, 2, 5], remainder 2 -> goes to indexes 1 and 2.
    expect(allocateLargestRemainder(10n, [1n, 2n, 4n])).toEqual([1n, 3n, 6n])
  })

  test('always sums to the total across many awkward cases', () => {
    for (let total = 0n; total <= 50n; total++) {
      const result = allocateLargestRemainder(total, [7n, 3n, 3n, 1n])
      expect(result.reduce((a, b) => a + b, 0n)).toBe(total)
    }
  })

  test('members with zero weight get zero', () => {
    expect(allocateLargestRemainder(9n, [1n, 0n, 2n])).toEqual([3n, 0n, 6n])
  })

  test('throws when weights are empty or all zero', () => {
    expect(() => allocateLargestRemainder(10n, [])).toThrow()
    expect(() => allocateLargestRemainder(10n, [0n, 0n])).toThrow()
  })

  test('throws on negative total or weights', () => {
    expect(() => allocateLargestRemainder(-1n, [1n])).toThrow()
    expect(() => allocateLargestRemainder(1n, [-1n, 2n])).toThrow()
  })
})

describe('rateFromDecimalString', () => {
  test('parses a same-exponent rate (KRW per JPY, both 0-digit)', () => {
    // 9.205 KRW per JPY == 9205/1000 minor per minor
    expect(rateFromDecimalString('9.205', 'KRW', 'JPY')).toEqual({
      numerator: 9205n,
      denominator: 1000n,
    })
  })

  test('rescales exponents (KRW per USD: 0-digit vs 2-digit)', () => {
    // 1330.5 KRW per USD -> per cent: 13.305 == 13305/1000
    expect(rateFromDecimalString('1330.5', 'KRW', 'USD')).toEqual({
      numerator: 13305n,
      denominator: 1000n,
    })
  })

  test('parses integer rates', () => {
    expect(rateFromDecimalString('9', 'KRW', 'JPY')).toEqual({
      numerator: 9n,
      denominator: 1n,
    })
  })

  test('rejects malformed or non-positive rates', () => {
    expect(() => rateFromDecimalString('abc', 'KRW', 'JPY')).toThrow()
    expect(() => rateFromDecimalString('', 'KRW', 'JPY')).toThrow()
    expect(() => rateFromDecimalString('-9.2', 'KRW', 'JPY')).toThrow()
    expect(() => rateFromDecimalString('0', 'KRW', 'JPY')).toThrow()
  })
})

describe('rateToDecimalString', () => {
  test('renders the Japan-scenario average 9.205 KRW/JPY', () => {
    expect(
      rateToDecimalString(
        { numerator: 736_400n, denominator: 80_000n },
        'KRW',
        'JPY',
      ),
    ).toBe('9.205')
  })

  test('accounts for differing minor-unit digits (USD settlement, JPY foreign)', () => {
    // 1 minor USD per 1 minor JPY = 0.01 USD per JPY.
    expect(
      rateToDecimalString({ numerator: 1n, denominator: 1n }, 'USD', 'JPY'),
    ).toBe('0.01')
  })

  test('rounds half-even at maxDecimals and keeps an integer digit', () => {
    expect(
      rateToDecimalString({ numerator: 1n, denominator: 3n }, 'KRW', 'JPY', 4),
    ).toBe('0.3333')
    expect(
      rateToDecimalString({ numerator: 10n, denominator: 1n }, 'KRW', 'JPY'),
    ).toBe('10')
  })

  test('round-trips through rateFromDecimalString at 10 decimals', () => {
    const rate = rateFromDecimalString('9.205', 'KRW', 'JPY')
    expect(rateToDecimalString(rate, 'KRW', 'JPY', 10)).toBe('9.205')
  })
})
