import { describe, expect, it } from 'vitest'
import { resolveTripDestination } from './trip-destination'

/**
 * "Where are you going?" is answered with a PLACE. The currency is derived
 * here and never posted by the client, so a stale or hand-crafted form value
 * cannot set a trip currency that disagrees with the country on screen.
 */
describe('resolveTripDestination', () => {
  it('derives the currency from the country', () => {
    expect(resolveTripDestination('JP', 'Kyoto')).toEqual({
      country: 'JP',
      city: 'Kyoto',
      currency: 'JPY',
    })
  })

  it('accepts a country with no city', () => {
    expect(resolveTripDestination('TH', '')).toEqual({
      country: 'TH',
      city: null,
      currency: 'THB',
    })
    expect(resolveTripDestination('TH', undefined).city).toBeNull()
  })

  it('drops a city that does not belong to the country', () => {
    // A country change that raced the city field must not strand Kyoto in
    // Thailand.
    expect(resolveTripDestination('TH', 'Kyoto')).toEqual({
      country: 'TH',
      city: null,
      currency: 'THB',
    })
  })

  it('treats an unknown or empty country as "not decided"', () => {
    const none = { country: null, city: null, currency: null }
    expect(resolveTripDestination('', '')).toEqual(none)
    expect(resolveTripDestination(undefined, undefined)).toEqual(none)
    expect(resolveTripDestination('ZZ', 'Nowhere')).toEqual(none)
    // A currency code is not a country, even though this field used to hold one.
    expect(resolveTripDestination('JPY', '')).toEqual(none)
  })

  it('is forgiving about case and whitespace on the country', () => {
    expect(resolveTripDestination(' jp ', 'Tokyo').currency).toBe('JPY')
  })

  it('trims the city before matching it', () => {
    expect(resolveTripDestination('JP', '  Osaka  ').city).toBe('Osaka')
  })

  it('several eurozone countries all resolve to EUR', () => {
    for (const code of ['FR', 'IT', 'ES', 'DE']) {
      expect(resolveTripDestination(code, '').currency, code).toBe('EUR')
    }
  })
})
