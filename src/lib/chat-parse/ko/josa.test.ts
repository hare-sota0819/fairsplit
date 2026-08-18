import { describe, expect, test } from 'vitest'
import { detachJosa, josaAgreesWithStem } from './josa'
import { JOSA } from './lexicon-josa'

describe('detachJosa', () => {
  test.each([
    ['민수랑', { stem: '민수', josa: '랑' }],
    ['민수가', { stem: '민수', josa: '가' }],
    ['철수는', { stem: '철수', josa: '는' }],
    ['영희도', { stem: '영희', josa: '도' }],
    ['민수한테', { stem: '민수', josa: '한테' }],
    ['민수님이', { stem: '민수님', josa: '이' }],
  ])('%s -> %o', (word, expected) => {
    expect(detachJosa(word)).toEqual(expected)
  })

  test.each(['민수', '김치찌개'])('%s -> null', (word) => {
    expect(detachJosa(word)).toBeNull()
  })

  // Allomorph agreement: 이/은/을/과/이랑 require batchim on the stem's last
  // syllable; 가/는/를/와/랑 require NO batchim. A stem+josa pair that
  // violates its own allomorph is not a legal split even though the bare
  // characters happen to line up.
  test('rejects a batchim-mismatched allomorph even if a shorter legal split exists', () => {
    // '민수이' — '이' requires batchim on '수', which has none; no legal
    // split exists for this exact word (no other josa suffixes it either).
    expect(detachJosa('민수이')).toBeNull()
  })

  test('로 is legal after no batchim or after ㄹ batchim', () => {
    expect(detachJosa('학교로')).toEqual({ stem: '학교', josa: '로' })
    expect(detachJosa('서울로')).toEqual({ stem: '서울', josa: '로' })
  })

  test.each([
    ['사람이나', { stem: '사람', josa: '이나' }],
    ['커피나', { stem: '커피', josa: '나' }],
    ['밥이라도', { stem: '밥', josa: '이라도' }],
    ['커피라도', { stem: '커피', josa: '라도' }],
    ['밥으로', { stem: '밥', josa: '으로' }],
    ['집으로서', { stem: '집', josa: '으로서' }],
    ['친구로서', { stem: '친구', josa: '로서' }],
    ['수단으로써', { stem: '수단', josa: '으로써' }],
    ['도구로써', { stem: '도구', josa: '로써' }],
    ['서울로써', { stem: '서울', josa: '로써' }], // ㄹ exception on the bare 로-family form
  ])('%s -> %o (extended alternating pairs)', (word, expected) => {
    expect(detachJosa(word)).toEqual(expected)
  })
})

describe('batchim-agreement coverage — every JOSA entry with a 이-/으-prefix bare counterpart', () => {
  // A re-mine that adds a new alternating pair to JOSA without registering
  // it in josa.ts's tables would silently fall through to "always agrees"
  // (the same enumerated-narrower-than-domain failure logged repeatedly in
  // docs/SOLVED.md for readKoreanNumber) — this derives the pairs straight
  // from JOSA itself instead of hardcoding them, so a missed pair fails
  // this test loudly instead of silently.
  const NO_BATCHIM_STEM = '수' // no jongseong
  const BATCHIM_STEM = '민' // jongseong ㄴ (not ㄹ)
  const RIEUL_STEM = '울' // jongseong ㄹ

  const pairs = JOSA.filter((j) => j.startsWith('이') || j.startsWith('으'))
    .map((j) => [j, j.slice(1)] as const)
    .filter(([, bare]) => JOSA.includes(bare))

  test('derives exactly the known 이-/으-prefix families (guards the derivation itself)', () => {
    expect(pairs.map(([full]) => full).sort()).toEqual(
      ['으로', '으로서', '으로써', '이나', '이라도', '이랑'].sort(),
    )
  })

  test.each(pairs)('%s / %s agree oppositely on batchim', (full, bare) => {
    expect(josaAgreesWithStem(NO_BATCHIM_STEM, full)).toBe(false)
    expect(josaAgreesWithStem(NO_BATCHIM_STEM, bare)).toBe(true)
    expect(josaAgreesWithStem(BATCHIM_STEM, full)).toBe(true)
    expect(josaAgreesWithStem(BATCHIM_STEM, bare)).toBe(false)
  })

  // ㄹ-final batchim exception: only the 로-family's BARE form (never the
  // 으-form) also accepts a ㄹ-final stem.
  test.each(['로', '로서', '로써'])(
    '%s also agrees after a ㄹ-final batchim',
    (bare) => {
      expect(josaAgreesWithStem(RIEUL_STEM, bare)).toBe(true)
    },
  )
  test.each(['으로', '으로서', '으로써'])(
    '%s does NOT agree after a ㄹ-final batchim',
    (eu) => {
      expect(josaAgreesWithStem(RIEUL_STEM, eu)).toBe(false)
    },
  )
})
