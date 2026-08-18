import { describe, expect, it } from 'vitest'
import {
  CURRENCY_WORDS_EN,
  MONEY_UNITS_EN,
  PAY_VERBS_EN,
  PAY_VERB_ENTRIES_EN,
  SPLIT_EN,
  SPLIT_ENTRIES_EN,
} from './lexicon'

describe('PAY_VERBS_EN', () => {
  it('is derived from the entry table, with no duplicates', () => {
    expect(PAY_VERBS_EN).toEqual(PAY_VERB_ENTRIES_EN.map((e) => e.phrase))
    expect(new Set(PAY_VERBS_EN).size).toBe(PAY_VERBS_EN.length)
  })

  it.each([
    'paid',
    'covered',
    'picked up the tab',
    'chipped in',
    'fronted',
    'spotted',
    'treated',
    'got it',
    'bought',
  ])('contains the brief phrase %s', (phrase) => {
    expect(PAY_VERBS_EN).toContain(phrase)
  })

  it('holds lowercase, single-spaced phrases (the matcher splits on the space)', () => {
    for (const phrase of PAY_VERBS_EN) {
      expect(phrase).toBe(phrase.toLowerCase())
      expect(phrase).toMatch(/^[a-z]+(?: [a-z]+)*$/)
    }
  })
})

describe('SPLIT_EN', () => {
  it('is derived from the entry table', () => {
    expect(SPLIT_EN).toEqual(SPLIT_ENTRIES_EN.map((e) => e.text))
  })

  it.each(['split', 'evenly', 'each', 'went dutch', 'went halves', 'everyone', 'all together', 'half'])(
    'contains %s',
    (phrase) => {
      expect(SPLIT_EN).toContain(phrase)
    },
  )

  // An n-ways expression is a grammar (a number, then "ways"), read by
  // parsers/split.ts — listing "three ways" here would silently mean "four
  // ways" is unrecognised.
  it('holds no literal n-ways phrase', () => {
    expect(SPLIT_EN.some((phrase) => phrase.includes('ways'))).toBe(false)
  })
})

describe('CURRENCY_WORDS_EN / MONEY_UNITS_EN', () => {
  it.each([
    ['bucks', 'USD'],
    ['buck', 'USD'],
    ['dollars', 'USD'],
    ['quid', 'GBP'],
    ['euros', 'EUR'],
    ['euro', 'EUR'],
    ['won', 'KRW'],
    ['yen', 'JPY'],
  ])('%s -> %s', (word, code) => {
    expect(CURRENCY_WORDS_EN.get(word)).toBe(code)
  })

  it('maps every word to a 3-letter ISO 4217 code', () => {
    for (const [word, code] of CURRENCY_WORDS_EN) {
      expect(word).toBe(word.toLowerCase())
      expect(code).toMatch(/^[A-Z]{3}$/)
    }
  })

  // `grand` multiplies but names no currency, so it is a money UNIT, not a
  // currency word — putting it in the map above would mean inventing an ISO
  // code for it.
  it('keeps grand out of the currency words and in the money units', () => {
    expect(CURRENCY_WORDS_EN.has('grand')).toBe(false)
    expect(MONEY_UNITS_EN.get('grand')).toBe(1000n)
  })

  it('has no word in both tables', () => {
    for (const word of MONEY_UNITS_EN.keys()) expect(CURRENCY_WORDS_EN.has(word)).toBe(false)
  })
})
