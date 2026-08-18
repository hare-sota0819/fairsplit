import { describe, expect, it } from 'vitest'
import { clampDecimals, isPlainDecimal, withinTolerance } from './decimal-text'

describe('isPlainDecimal', () => {
  it('accepts unsigned decimal literals', () => {
    expect(isPlainDecimal('9')).toBe(true)
    expect(isPlainDecimal('9.140467827')).toBe(true)
    expect(isPlainDecimal('0.109403591')).toBe(true)
  })

  it('refuses signs, exponents and junk', () => {
    expect(isPlainDecimal('-9.14')).toBe(false)
    expect(isPlainDecimal('9.1e2')).toBe(false)
    expect(isPlainDecimal('')).toBe(false)
    expect(isPlainDecimal('9.')).toBe(false)
  })
})

describe('clampDecimals', () => {
  it('leaves a value that already fits', () => {
    expect(clampDecimals('9.140467827', 10)).toBe('9.140467827')
    expect(clampDecimals('1430', 10)).toBe('1430')
  })

  it('truncates rather than rounds, so it never exceeds the source', () => {
    // 11 places -> 10. A rounding implementation would give ...9999999999 -> 1
    expect(clampDecimals('1.99999999999', 10)).toBe('1.9999999999')
    expect(clampDecimals('9.1404678279', 4)).toBe('9.1404')
  })

  it('trims the trailing zeros truncation exposes', () => {
    expect(clampDecimals('9.1400000001', 4)).toBe('9.14')
    expect(clampDecimals('9.0000000001', 4)).toBe('9')
  })

  it('is exact on a value far beyond float precision', () => {
    const long = `1.${'1234567890'.repeat(4)}`
    expect(clampDecimals(long, 10)).toBe('1.123456789')
  })
})

describe('withinTolerance', () => {
  it('accepts two live sources a fraction of a percent apart', () => {
    // Measured 2026-08-03: fxratesapi 9.140467827 vs Wise mid 9.13813.
    expect(withinTolerance('9.140467827', '9.13813', 5)).toBe(true)
  })

  it('accepts the real ECB-vs-live gap that motivated this phase', () => {
    // 9.0093 (ECB, 3 days stale) vs 9.140467827 (live) = 1.44% apart.
    expect(withinTolerance('9.140467827', '9.0093', 5)).toBe(true)
  })

  it('rejects a 100x error', () => {
    expect(withinTolerance('914.0467827', '9.140467827', 5)).toBe(false)
    expect(withinTolerance('0.09140467827', '9.140467827', 5)).toBe(false)
  })

  it('is exact at the boundary', () => {
    expect(withinTolerance('105', '100', 5)).toBe(true)
    expect(withinTolerance('95', '100', 5)).toBe(true)
    expect(withinTolerance('105.000000001', '100', 5)).toBe(false)
    expect(withinTolerance('94.999999999', '100', 5)).toBe(false)
  })

  it('aligns differing scales', () => {
    expect(withinTolerance('9.1', '9.100000000000', 5)).toBe(true)
    expect(withinTolerance('9', '9.0', 0)).toBe(true)
  })

  it('refuses a zero or malformed reference instead of dividing by it', () => {
    expect(withinTolerance('9.14', '0', 5)).toBe(false)
    expect(withinTolerance('9.14', '0.00', 5)).toBe(false)
    expect(withinTolerance('9.14', 'abc', 5)).toBe(false)
    expect(withinTolerance('-9.14', '9.14', 5)).toBe(false)
  })
})
