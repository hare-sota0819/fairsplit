import { describe, expect, it } from 'vitest'
import {
  ADJ_ATTRIBUTIVE,
  attributiveOf,
  isAdjectiveAttributive,
  isVerbAttributive,
  readClauseForm,
} from './attributive'
import { ADJ_STEMS_KO, VERB_STEMS_KO } from './lexicon-verbs'

describe('readClauseForm — verb forms are clause boundaries', () => {
  // The exact residual list Task 4 ledgered as unresolvable without a verb
  // lexicon (people.ts's KNOWN RESIDUAL comment, docs/SOLVED.md rounds 2-4).
  it.each([
    ['추천한', '추천하', 'ㄴ'],
    ['고른', '고르', 'ㄴ'],
    ['시킨', '시키', 'ㄴ'],
    ['먹은', '먹', '은'],
    ['산', '사', 'ㄴ'],
    ['만든', '만들', 'ㄴ'],
    ['예약하고', '예약하', '고'],
    ['먹을', '먹', '을'],
  ])('%s -> verb (stem %s, ending %s)', (word, stem, ending) => {
    expect(readClauseForm(word)).toEqual(
      expect.objectContaining({ kind: 'verb', stem, ending }),
    )
  })

  it.each([
    ['추천해서', '추천하'],
    ['먹어서', '먹'],
    ['먹었는데', '먹'],
    ['먹는데', '먹'],
    ['먹던', '먹'],
    ['먹었던', '먹'],
    ['먹는', '먹'],
    ['시켰는데', '시키'],
    ['사줬는데', '사주'],
    ['나눈', '나누'],
    ['빌린', '빌리'],
    ['긁은', '긁'],
    ['주문한', '주문하'],
    ['결제하고', '결제하'],
  ])('%s -> verb (stem %s)', (word, stem) => {
    expect(readClauseForm(word)).toMatchObject({ kind: 'verb', stem })
  })
})

describe('readClauseForm — adjective forms are NOT clause boundaries', () => {
  it.each([
    ['유명한', '유명하'],
    ['시원한', '시원하'],
    ['저렴한', '저렴하'],
    ['간단한', '간단하'],
    ['편한', '편하'],
    ['착한', '착하'],
    ['좋은', '좋'],
    ['많은', '많'],
    ['큰', '크'],
    ['작은', '작'],
    ['비싼', '비싸'],
    ['맛있는', '맛있'],
    ['괜찮은', '괜찮'],
  ])('%s -> adjective (stem %s)', (word, stem) => {
    expect(readClauseForm(word)).toMatchObject({ kind: 'adjective', stem })
    expect(isVerbAttributive(word)).toBe(false)
    expect(isAdjectiveAttributive(word)).toBe(true)
  })
})

describe('readClauseForm — unknown is no hit, never a wrong hit', () => {
  // Every one of these broke a Task 4 review round when the recognizer was an
  // ending set with no stem lexicon behind it.
  it.each([
    '한', // the determiner "one" (맥주 한 잔)
    '던',
    '두',
    '세',
    '원', // currency unit (3만원)
    '잔', // counter (커피 두 잔)
    '반', // 저녁값 반반
    '건', // counter (사건)
    '대한', // multi-syllable noun ending in 한
    '무한',
    '식당에서', // location particle, not the -해서 connective
    '술하고', // companion josa, not the -하고 connective
    '카드로',
    '어제',
    '저녁',
    '유나가',
    '민수한테',
  ])('%s -> null', (word) => {
    expect(readClauseForm(word)).toBeNull()
    expect(isVerbAttributive(word)).toBe(false)
    expect(isAdjectiveAttributive(word)).toBe(false)
  })
})

describe('ADJ_ATTRIBUTIVE', () => {
  it('is generated from the adjective stems, not hand-listed', () => {
    expect(ADJ_ATTRIBUTIVE.length).toBe(ADJ_STEMS_KO.length)
    expect(ADJ_ATTRIBUTIVE).toContain('유명한')
    expect(ADJ_ATTRIBUTIVE).toContain('시원한')
    expect(ADJ_ATTRIBUTIVE).toContain('맛있는')
    expect(ADJ_ATTRIBUTIVE).toContain('좋은')
  })

  it.each(ADJ_ATTRIBUTIVE)('%s reads back as an adjective', (form) => {
    expect(readClauseForm(form)).toMatchObject({ kind: 'adjective' })
  })

  it('never collides with a verb attributive form', () => {
    const verbForms = new Set(VERB_STEMS_KO.map(attributiveOf))
    for (const form of ADJ_ATTRIBUTIVE) expect(verbForms.has(form)).toBe(false)
  })
})

describe('verb attributive round-trip', () => {
  it.each(VERB_STEMS_KO)('%s conjugates and reads back as a verb', (stem) => {
    const form = attributiveOf(stem)
    expect(form).not.toBeNull()
    expect(readClauseForm(form as string)).toMatchObject({ kind: 'verb', stem })
  })
})
