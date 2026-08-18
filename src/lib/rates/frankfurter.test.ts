import { describe, expect, test } from 'vitest'
import { extractQuoteDate, extractRateLiteral, parseQuote } from './frankfurter'

// The exact body the reported defect came from: asked on Sunday
// 2026-08-02, answered with Friday's fix.
const SUNDAY_BODY =
  '{"amount":1.0,"base":"JPY","date":"2026-07-31","rates":{"KRW":9.0093}}'

describe('extractRateLiteral', () => {
  test('pulls the decimal literal without a float round-trip', () => {
    const body =
      '{"amount":1.0,"base":"JPY","date":"2026-07-30","rates":{"KRW":9.205}}'
    expect(extractRateLiteral(body, 'KRW')).toBe('9.205')
  })

  test('integer rates work', () => {
    expect(extractRateLiteral('{"rates":{"KRW":9}}', 'KRW')).toBe('9')
  })

  test('missing quote currency returns null', () => {
    expect(extractRateLiteral('{"rates":{"USD":0.0067}}', 'KRW')).toBeNull()
  })

  test('exponent or negative literals are refused (defensive)', () => {
    expect(extractRateLiteral('{"rates":{"KRW":9.2e3}}', 'KRW')).toBeNull()
    expect(extractRateLiteral('{"rates":{"KRW":-9.2}}', 'KRW')).toBeNull()
  })
})

describe('extractQuoteDate', () => {
  test('reads the date the answer is actually for', () => {
    expect(extractQuoteDate(SUNDAY_BODY)).toBe('2026-07-31')
  })

  test('a body without a date is unusable', () => {
    expect(extractQuoteDate('{"rates":{"KRW":9}}')).toBeNull()
  })
})

describe('parseQuote', () => {
  test('carries the rate and its as-of date together', () => {
    expect(parseQuote(SUNDAY_BODY, 'KRW')).toEqual({
      rate: '9.0093',
      asOf: '2026-07-31',
    })
  })

  test('a rate with no date is refused rather than passed off as current', () => {
    expect(parseQuote('{"rates":{"KRW":9.0093}}', 'KRW')).toBeNull()
  })
})
