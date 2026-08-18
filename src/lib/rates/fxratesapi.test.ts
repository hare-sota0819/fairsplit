import { describe, expect, it } from 'vitest'
import {
  extractQuoteInstant,
  extractRateLiteral,
  parseQuote,
} from './fxratesapi'

// Captured verbatim from api.fxratesapi.com on 2026-08-03.
const LATEST = `{"success":true,"terms":"https://fxratesapi.com/legal/terms-conditions","privacy":"https://fxratesapi.com/legal/privacy-policy","timestamp":1785726180,"date":"2026-08-03T03:03:00.000Z","base":"JPY","rates":{"KRW":9.140467827}}`

const WEEKEND = `{"success":true,"timestamp":1785634680,"date":"2026-08-02T01:38:00.000Z","base":"JPY","rates":{"KRW":9.162781326}}`

const ERROR = `{"success":false,"error":"invalid_currencies","description":"The currencies parameter is not valid."}`

describe('extractRateLiteral', () => {
  it('reads the literal out of the raw body, never through a float', () => {
    expect(extractRateLiteral(LATEST, 'KRW')).toBe('9.140467827')
  })

  it('clamps to the 10 decimals the storage column holds', () => {
    const body = `{"rates":{"KRW":1430.46514765941234}}`
    expect(extractRateLiteral(body, 'KRW')).toBe('1430.4651476594')
  })

  it('returns null for a missing quote currency', () => {
    expect(extractRateLiteral(LATEST, 'TWD')).toBeNull()
  })

  it('refuses signed and exponent literals rather than mis-reading them', () => {
    expect(extractRateLiteral(`{"rates":{"KRW":-9.14}}`, 'KRW')).toBeNull()
    expect(extractRateLiteral(`{"rates":{"KRW":9.14e2}}`, 'KRW')).toBeNull()
  })
})

describe('extractQuoteInstant', () => {
  it('reads the snapshot instant, not just the date', () => {
    expect(extractQuoteInstant(LATEST)).toBe('2026-08-03T03:03:00.000Z')
  })

  it('accepts an instant with no milliseconds', () => {
    expect(extractQuoteInstant(`{"date":"2026-08-03T03:03:00Z"}`)).toBe(
      '2026-08-03T03:03:00Z',
    )
  })

  it('returns null for a date-only field', () => {
    // Frankfurter's shape. Parsing it here would silently mislabel a daily
    // fixing as a minute-precise snapshot.
    expect(extractQuoteInstant(`{"date":"2026-07-31"}`)).toBeNull()
  })
})

describe('parseQuote', () => {
  it('carries the source timestamp alongside the date', () => {
    expect(parseQuote(LATEST, 'KRW')).toEqual({
      rate: '9.140467827',
      asOf: '2026-08-03',
      asOfInstant: '2026-08-03T03:03:00.000Z',
    })
  })

  it('stamps a weekend quote with the weekend day it is actually for', () => {
    // The whole point of the swap: the ECB has only Friday for this date.
    expect(parseQuote(WEEKEND, 'KRW')?.asOf).toBe('2026-08-02')
  })

  it('refuses an error body outright', () => {
    expect(parseQuote(ERROR, 'KRW')).toBeNull()
    // ...even one that happens to contain a number under the quote key.
    expect(
      parseQuote(
        `{"success":false,"date":"2026-08-03T03:03:00.000Z","KRW":1}`,
        'KRW',
      ),
    ).toBeNull()
  })

  it('refuses a body with a rate but no timestamp', () => {
    expect(parseQuote(`{"rates":{"KRW":9.14}}`, 'KRW')).toBeNull()
  })
})
