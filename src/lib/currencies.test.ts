import currencyCodes from 'currency-codes'
import { describe, expect, test } from 'vitest'
import { CURATED_CURRENCIES, missingDestinationCurrencies } from './currencies'
import { DESTINATIONS } from './destinations'

describe('CURATED_CURRENCIES', () => {
  test('every entry is a real ISO 4217 code', () => {
    for (const code of CURATED_CURRENCIES) {
      expect(currencyCodes.code(code), code).toBeDefined()
    }
  })

  test('no duplicates', () => {
    expect(new Set(CURATED_CURRENCIES).size).toBe(CURATED_CURRENCIES.length)
  })

  test('the settlement defaults still lead the list', () => {
    expect([...CURATED_CURRENCIES].slice(0, 6)).toEqual([
      'KRW',
      'JPY',
      'USD',
      'EUR',
      'GBP',
      'CNY',
    ])
  })

  /**
   * THE INVARIANT. Picking a trip destination sets the trip currency from
   * that country, and the expense form can only offer what is listed here —
   * so a destination whose currency is missing would set a default the user
   * cannot see or type. Adding a country therefore fails the gate until its
   * currency is added too.
   */
  test('offers every currency a destination can imply', () => {
    expect(missingDestinationCurrencies()).toEqual([])
  })

  test('and the two lists really are connected', () => {
    // Guards the test above against silently passing on an empty list.
    expect(DESTINATIONS.length).toBeGreaterThan(40)
    const offered = new Set<string>(CURATED_CURRENCIES)
    for (const destination of DESTINATIONS) {
      expect(offered.has(destination.currency), destination.code).toBe(true)
    }
  })
})
