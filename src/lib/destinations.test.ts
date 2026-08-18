import { countries } from 'countries-list'
import { describe, expect, it } from 'vitest'

import {
  DESTINATIONS,
  destinationCurrencies,
  destinationFor,
  flagEmoji,
} from './destinations'

describe('DESTINATIONS', () => {
  it('has between 45 and 55 entries', () => {
    expect(DESTINATIONS.length).toBeGreaterThanOrEqual(45)
    expect(DESTINATIONS.length).toBeLessThanOrEqual(55)
  })

  it('has unique codes', () => {
    const codes = DESTINATIONS.map((d) => d.code)
    expect(new Set(codes).size).toBe(codes.length)
  })

  it('is sorted by name', () => {
    const names = DESTINATIONS.map((d) => d.name)
    const sorted = [...names].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))
    expect(names).toEqual(sorted)
  })

  it('every code is a real ISO 3166-1 alpha-2 key in countries-list', () => {
    for (const d of DESTINATIONS) {
      expect(
        countries[d.code as keyof typeof countries],
        `unknown code ${d.code}`,
      ).toBeDefined()
    }
  })

  it('every name matches countries-list exactly', () => {
    for (const d of DESTINATIONS) {
      const entry = countries[d.code as keyof typeof countries]
      expect(d.name, `name mismatch for ${d.code}`).toBe(entry.name)
    }
  })

  it('every currency matches the first entry of countries-list currency array', () => {
    for (const d of DESTINATIONS) {
      const entry = countries[d.code as keyof typeof countries]
      expect(d.currency, `currency mismatch for ${d.code}`).toBe(
        entry.currency[0],
      )
    }
  })

  it('every destination has 5-8 unique, non-empty cities distinct from the country name', () => {
    for (const d of DESTINATIONS) {
      expect(d.cities.length, `${d.code} city count`).toBeGreaterThanOrEqual(5)
      expect(d.cities.length, `${d.code} city count`).toBeLessThanOrEqual(8)

      for (const city of d.cities) {
        expect(
          city.trim().length,
          `${d.code} has an empty city`,
        ).toBeGreaterThan(0)
        expect(city, `${d.code} lists the country name as a city`).not.toBe(
          d.name,
        )
      }

      expect(new Set(d.cities).size, `${d.code} has duplicate cities`).toBe(
        d.cities.length,
      )
    }
  })

  it('includes several obvious global destinations', () => {
    const names = DESTINATIONS.map((d) => d.name)
    for (const expected of [
      'Japan',
      'France',
      'Italy',
      'Thailand',
      'United States',
      'Egypt',
      'Brazil',
      'Australia',
    ]) {
      expect(names, `missing ${expected}`).toContain(expected)
    }
  })
})

describe('flagEmoji', () => {
  it('builds regional-indicator flags for known codes', () => {
    expect(flagEmoji('JP')).toBe('🇯🇵')
    expect(flagEmoji('KR')).toBe('🇰🇷')
  })

  it('is case-insensitive', () => {
    expect(flagEmoji('jp')).toBe('🇯🇵')
    expect(flagEmoji('Jp')).toBe('🇯🇵')
  })

  it('returns empty string for anything that is not exactly two ASCII letters', () => {
    expect(flagEmoji('')).toBe('')
    expect(flagEmoji('X')).toBe('')
    expect(flagEmoji('XYZ')).toBe('')
    expect(flagEmoji('j1')).toBe('')
  })
})

describe('destinationFor', () => {
  it('finds a known code', () => {
    expect(destinationFor('JP')?.name).toBe('Japan')
  })

  it('returns undefined for an unknown code', () => {
    expect(destinationFor('ZZ')).toBeUndefined()
  })
})

describe('destinationCurrencies', () => {
  const currencies = destinationCurrencies()

  it('is sorted', () => {
    expect(currencies).toEqual([...currencies].sort())
  })

  it('is deduplicated', () => {
    expect(new Set(currencies).size).toBe(currencies.length)
  })

  it('contains JPY and EUR', () => {
    expect(currencies).toContain('JPY')
    expect(currencies).toContain('EUR')
  })
})
