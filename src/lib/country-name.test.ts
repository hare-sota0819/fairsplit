import { describe, expect, test } from 'vitest'
import { countryName } from './country-name'
import { DESTINATIONS } from './destinations'

describe('countryName', () => {
  test('names the country in the reader’s language', () => {
    expect(countryName('JP', 'ko')).toBe('일본')
    expect(countryName('JP', 'en')).toBe('Japan')
    expect(countryName('VN', 'ko')).toBe('베트남')
  })

  test('accepts a lowercase code, since ISO data is not always uppercased', () => {
    expect(countryName('jp', 'ko')).toBe('일본')
  })

  test('is null for anything that is not a two-letter code', () => {
    expect(countryName('JPN', 'ko')).toBeNull()
    expect(countryName('', 'ko')).toBeNull()
    expect(countryName('J1', 'ko')).toBeNull()
  })

  test('is null rather than echoing the code back for an unknown region', () => {
    // The caller needs to be able to fall back to different copy; a country
    // name of "QQ" would be worse than the sentence it replaces.
    expect(countryName('QQ', 'ko')).toBeNull()
  })

  test('every destination the trip picker offers has a Korean name', () => {
    // The prompt this exists for is shown for whichever country the group
    // chose, so a gap here is a gap on screen.
    for (const destination of DESTINATIONS) {
      expect(
        countryName(destination.code, 'ko'),
        `${destination.code} (${destination.name})`,
      ).toBeTruthy()
    }
  })
})
