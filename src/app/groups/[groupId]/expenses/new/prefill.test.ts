import { describe, expect, test } from 'vitest'
import { resolvePrefill } from './prefill'

describe('resolvePrefill', () => {
  test('no draftAmount at all means no handoff', () => {
    expect(resolvePrefill('KRW', {})).toBeUndefined()
  })

  test('valid trio carries through, currency validated', () => {
    expect(
      resolvePrefill('KRW', {
        draftAmount: '45.60',
        draftNote: 'lunch',
        draftCurrency: 'USD',
      }),
    ).toEqual({ amount: '45.60', currency: 'USD', note: 'lunch' })
  })

  test('invalid amount drops ONLY amount, keeps currency and note', () => {
    // JPY has zero minor-unit digits; a decimal amount fails to parse.
    expect(
      resolvePrefill('KRW', {
        draftAmount: '1200.5',
        draftNote: 'ramen',
        draftCurrency: 'JPY',
      }),
    ).toEqual({ currency: 'JPY', note: 'ramen' })
  })

  test('unrecognized currency falls back to the settlement currency', () => {
    expect(
      resolvePrefill('KRW', {
        draftAmount: '10',
        draftNote: '',
        draftCurrency: 'ZZZ',
      }),
    ).toEqual({ amount: '10', currency: 'KRW', note: '' })
  })

  test('a repeated query param arrives as an array and is treated as absent', () => {
    expect(
      resolvePrefill('KRW', {
        draftAmount: ['1', '2'],
        draftNote: 'lunch',
        draftCurrency: 'USD',
      }),
    ).toBeUndefined()
    expect(
      resolvePrefill('KRW', {
        draftAmount: '10',
        draftNote: ['a', 'b'],
        draftCurrency: ['USD', 'EUR'],
      }),
    ).toEqual({ amount: '10', currency: 'KRW', note: '' })
  })

  test('missing note defaults to empty string', () => {
    expect(
      resolvePrefill('KRW', { draftAmount: '10', draftCurrency: 'USD' }),
    ).toEqual({ amount: '10', currency: 'USD', note: '' })
  })
})
