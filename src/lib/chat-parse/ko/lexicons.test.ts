import { describe, expect, test } from 'vitest'
import { JOSA } from './lexicon-josa'
import { NUMBER_DECOYS } from './lexicon-decoys'
import { TYPO_PAIRS } from './lexicon-typos'

describe('lexicon-josa — JOSA', () => {
  test('non-empty', () => {
    expect(JOSA.length).toBeGreaterThan(0)
  })

  test('sorted longest-first', () => {
    for (let i = 1; i < JOSA.length; i++) {
      expect(JOSA[i - 1].length).toBeGreaterThanOrEqual(JOSA[i].length)
    }
  })

  test.each(['이랑', '랑', '하고', '한테', '이', '가', '은', '는', '도', '을', '를'])(
    'contains %s',
    (josa) => {
      expect(JOSA).toContain(josa)
    },
  )
})

describe('lexicon-decoys — NUMBER_DECOYS', () => {
  test('non-empty', () => {
    expect(NUMBER_DECOYS.size).toBeGreaterThan(0)
  })

  // Task 2 seed (12 entries) — the natural regression guard for
  // mine-korean-lexicons.mjs's REQUIRED_DECOYS provenance-throw: this test
  // fails LOUDLY (not a silent missing-decoy) if a re-mine ever drops one.
  const TASK_2_SEED = [
    '만두',
    '천천히',
    '오만',
    '억지',
    '조금',
    '만약',
    '만일',
    '천사',
    '만성',
    '억양',
    '조각',
    '사장',
  ]
  test.each(TASK_2_SEED)('contains Task 2 seed entry %s', (word) => {
    expect(NUMBER_DECOYS.has(word)).toBe(true)
  })

  // Task 3 mandated <digit-syllable>+<counter> carry-over class (parked
  // finding from the Task 2 review loop, task-3-brief.md).
  const TASK_3_MANDATED = ['이번', '이분', '조이', '이장', '사병', '일병', '오분']
  test.each(TASK_3_MANDATED)('contains Task 3 mandated entry %s', (word) => {
    expect(NUMBER_DECOYS.has(word)).toBe(true)
  })
})

describe('lexicon-typos — TYPO_PAIRS', () => {
  test('non-empty', () => {
    expect(TYPO_PAIRS.size).toBeGreaterThan(0)
  })

  test('no entry maps a word to itself', () => {
    for (const [from, to] of TYPO_PAIRS) {
      expect(to).not.toBe(from)
    }
  })
})
