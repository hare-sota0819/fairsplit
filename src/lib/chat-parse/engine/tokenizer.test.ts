import { describe, expect, test } from 'vitest'
import fc from 'fast-check'
import { tokenize } from './tokenizer'
import { hangulInfo } from './tokens'
import type { Token } from './tokens'

test.each([
  [
    '13000원 김치찌개',
    [
      { kind: 'digits', text: '13000', start: 0, end: 5 },
      { kind: 'hangul', text: '원', start: 5, end: 6 },
      { kind: 'space', text: ' ', start: 6, end: 7 },
      { kind: 'hangul', text: '김치찌개', start: 7, end: 11 },
    ],
  ],
  [
    'paid $45.60 for lunch',
    [
      { kind: 'latin', text: 'paid', start: 0, end: 4 },
      { kind: 'space', text: ' ', start: 4, end: 5 },
      { kind: 'punct', text: '$', start: 5, end: 6 },
      { kind: 'digits', text: '45.60', start: 6, end: 11 },
      { kind: 'space', text: ' ', start: 11, end: 12 },
      { kind: 'latin', text: 'for', start: 12, end: 15 },
      { kind: 'space', text: ' ', start: 15, end: 16 },
      { kind: 'latin', text: 'lunch', start: 16, end: 21 },
    ],
  ],
  ['민수랑같이', [{ kind: 'hangul', text: '민수랑같이', start: 0, end: 5 }]],
  [
    '1.2k',
    [
      { kind: 'digits', text: '1.2', start: 0, end: 3 },
      { kind: 'latin', text: 'k', start: 3, end: 4 },
    ],
  ],
  ['', []],
  // extra rigor beyond the required table: comma separator variant of the digits nuance
  [
    '45,000원',
    [
      { kind: 'digits', text: '45,000', start: 0, end: 6 },
      { kind: 'hangul', text: '원', start: 6, end: 7 },
    ],
  ],
  // extra rigor: a trailing '.' NOT followed by a digit is punct, not part of the digits run
  [
    '3.',
    [
      { kind: 'digits', text: '3', start: 0, end: 1 },
      { kind: 'punct', text: '.', start: 1, end: 2 },
    ],
  ],
])('tokenize(%s)', (input, expected) => {
  const actual = tokenize(input)
  expect(actual.slice(0, expected.length)).toEqual(expected)
  expect(actual).toHaveLength(expected.length)
})

function assertLosslessAndContiguous(input: string): void {
  const tokens = tokenize(input)
  expect(tokens.map((t) => t.text).join('')).toBe(input)
  let cursor = 0
  for (const t of tokens) {
    expect(t.start).toBe(cursor)
    expect(t.end).toBe(cursor + t.text.length)
    expect(input.slice(t.start, t.end)).toBe(t.text)
    cursor = t.end
  }
  expect(cursor).toBe(input.length)
}

// fc.string()'s default unit ('grapheme-ascii' in fast-check 4.9.0) only covers printable
// ASCII, so it never exercises the exact domain this invariant protects: Hangul, emoji,
// astral code points, and lone surrogates. Run it over both 'binary' (arbitrary UTF-16 code
// units, including lone surrogates) and 'grapheme' (full Unicode graphemes) explicitly.
test('tokenize is lossless: token texts concatenate back to the input, offsets are contiguous (binary code units)', () => {
  fc.assert(fc.property(fc.string({ unit: 'binary' }), assertLosslessAndContiguous))
})

test('tokenize is lossless: token texts concatenate back to the input, offsets are contiguous (Unicode graphemes)', () => {
  fc.assert(fc.property(fc.string({ unit: 'grapheme' }), assertLosslessAndContiguous))
})

describe('hangulInfo', () => {
  test('disassembles each syllable and reports batchim of the last syllable', () => {
    const [token] = tokenize('값진')
    const info = hangulInfo(token as Token)
    expect(info.syllables).toEqual([
      { choseong: 'ㄱ', jungseong: 'ㅏ', jongseong: 'ㅂㅅ' },
      { choseong: 'ㅈ', jungseong: 'ㅣ', jongseong: 'ㄴ' },
    ])
    expect(info.finalBatchim).toBe(true)
  })

  test('finalBatchim is false when the last syllable has no batchim', () => {
    const [token] = tokenize('의자')
    const info = hangulInfo(token as Token)
    expect(info.finalBatchim).toBe(false)
  })

  test('standalone jamo (not a complete syllable) disassembles to null', () => {
    const [token] = tokenize('ㅋㅋㅋ')
    const info = hangulInfo(token as Token)
    expect(info.syllables).toEqual([null, null, null])
    expect(info.finalBatchim).toBe(false)
  })
})
