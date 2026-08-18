import { describe, expect, it } from 'vitest'
import { normalize } from './normalize'

describe('normalize', () => {
  it('collapses a repeated-tilde run to 2 (넹~~~~~~ -> 넹~~)', () => {
    expect(normalize('넹~~~~~~').text).toBe('넹~~')
  })

  it('collapses a repeated-jamo laughter run to 2 (ㅋㅋㅋㅋㅋ -> ㅋㅋ)', () => {
    expect(normalize('ㅋㅋㅋㅋㅋ').text).toBe('ㅋㅋ')
  })

  it('collapses a repeated-punctuation run to 2 (??? -> ??)', () => {
    expect(normalize('???').text).toBe('??')
  })

  it('does NOT damage ㄴㅇㅈ (three distinct jamo, no repeated run)', () => {
    expect(normalize('ㄴㅇㅈ').text).toBe('ㄴㅇㅈ')
  })

  it('does NOT fold ㄴㄴ down to ㄴ (a run of exactly 2 is untouched)', () => {
    expect(normalize('ㄴㄴ').text).toBe('ㄴㄴ')
  })

  it('does NOT fold ㅇㅇㅇ down to ㅇ (caps at 2, never 1)', () => {
    expect(normalize('ㅇㅇㅇ').text).toBe('ㅇㅇ')
  })

  it('never touches a repeated-digit run (40000 must stay 40000, not 400)', () => {
    // docs/SOLVED.md 2026-08-10: the run-collapse regex once used a
    // blanket `(.)` and silently truncated real numbers via their own
    // repeated digits (40000's four 0s -> 400).
    expect(normalize('40000').text).toBe('40000')
    expect(normalize('1000000').text).toBe('1000000')
  })

  it('leaves a bare single jamo untouched', () => {
    expect(normalize('ㅇ').text).toBe('ㅇ')
  })

  it('is idempotent: normalize(normalize(x).text) === normalize(x)', () => {
    for (const s of [
      '넹~~~~~~',
      'ㅋㅋㅋㅋㅋ',
      '???',
      'ㄴㅇㅈ',
      'ㄴㄴ',
      '  hi  ',
    ]) {
      const once = normalize(s)
      const twice = normalize(once.text)
      expect(twice.text).toBe(once.text)
    }
  })

  it('trims surrounding whitespace', () => {
    expect(normalize('  안녕  ').text).toBe('안녕')
  })

  it('builds a whitespace-removed shadow for F-1 붙여쓰기 matching', () => {
    expect(normalize('나 얼마 내면 돼').shadow).toBe('나얼마내면돼')
  })

  it('NFC-normalizes decomposed input (review I4)', () => {
    expect(normalize('가'.normalize('NFD')).text).toBe('가')
  })
})
