import { describe, expect, it } from 'vitest'
import {
  ADJ_STEMS_KO,
  PAY_VERBS_KO,
  PAY_VERBALIZER,
  PAY_VERB_ENDING,
  PAY_VERB_ENTRIES,
  PAY_VERB_SUFFIX,
  SPLIT_ENTRIES_KO,
  SPLIT_KO,
  VERB_STEMS_KO,
} from './lexicon-verbs'

describe('PAY_VERBS_KO', () => {
  it('is derived from the entry table, with no duplicates', () => {
    expect(PAY_VERBS_KO).toEqual(PAY_VERB_ENTRIES.map((e) => e.stem))
    expect(new Set(PAY_VERBS_KO).size).toBe(PAY_VERBS_KO.length)
  })

  it.each(['냈', '낸', '냄', '결제', '계산', '샀', '쐈', '긁었', '쏘', '사줬'])(
    'contains the brief stem %s',
    (stem) => {
      expect(PAY_VERBS_KO).toContain(stem)
    },
  )

  it('lists longer stems first, so a longer stem wins at the same position', () => {
    for (let i = 1; i < PAY_VERBS_KO.length; i++) {
      expect(PAY_VERBS_KO[i - 1].length).toBeGreaterThanOrEqual(PAY_VERBS_KO[i].length)
    }
  })

  it('holds pure-hangul stems', () => {
    for (const stem of PAY_VERBS_KO) expect(stem).toMatch(/^[가-힣]+$/)
  })
})

describe('PAY_VERB_SUFFIX / PAY_VERBALIZER (backlog #2)', () => {
  it.each(['했어', '함', '해줬어', '하고', '한', '할게'])(
    '%s verbalizes a verbal noun',
    (rest) => {
      expect(PAY_VERBALIZER.test(rest)).toBe(true)
      expect(PAY_VERB_SUFFIX.test(rest)).toBe(true)
    },
  )

  // The backlog #2 contract: a NOUN-forming suffix never verbalizes a verbal
  // noun, so 계산서/계산기/계산대/결제일 stay nouns.
  it.each(['서', '기', '대', '법', '일', '적', '상', '원'])(
    '%s is a noun-forming suffix and never verbalizes',
    (rest) => {
      expect(PAY_VERBALIZER.test(rest)).toBe(false)
    },
  )

  // 대/거 are also real verb endings (샀대, 냈거든), so they are in the union
  // — harmless, because a verbal-noun stem is never held to the union.
  it.each(['서', '기', '법', '일', '적', '상', '원'])(
    '%s follows no pay verb at all',
    (rest) => {
      expect(PAY_VERB_SUFFIX.test(rest)).toBe(false)
    },
  )

  it.each(['어', '었어', '다', '고', '는데', '지', '게', '으니까', '으면', '을'])(
    '%s may follow an inflected pay verb',
    (rest) => {
      expect(PAY_VERB_ENDING.test(rest)).toBe(true)
      expect(PAY_VERB_SUFFIX.test(rest)).toBe(true)
    },
  )

  it('is anchored — a suffix only counts where the stem ends', () => {
    expect(PAY_VERB_SUFFIX.test('서했어')).toBe(false)
  })
})

describe('SPLIT_KO', () => {
  it('is derived from the entry table', () => {
    expect(SPLIT_KO).toEqual(SPLIT_ENTRIES_KO.map((e) => e.text))
  })

  // Parity with index.ts's EVERYONE/HALF vocabulary — hasSplitKeyword's
  // behavior is the contract findSplit has to keep.
  it.each(['엔빵', 'n빵', '다같이', '모두', '전부', '나눠', '나누자', '반반', '절반'])(
    'keeps the existing keyword %s',
    (word) => {
      expect(SPLIT_KO).toContain(word)
    },
  )

  it('never includes bare 같이 (product ruling)', () => {
    expect(SPLIT_KO).not.toContain('같이')
  })

  it.each(SPLIT_ENTRIES_KO)('$text carries a mode and a confidence', (entry) => {
    expect(['everyone', 'half', 'n-ways', 'named-only']).toContain(entry.mode)
    expect(entry.confidence).toBeGreaterThan(0)
    expect(entry.confidence).toBeLessThanOrEqual(1)
  })
})

describe('verb / adjective stem lexicons', () => {
  it('are disjoint — a stem cannot be both classes', () => {
    const adj = new Set(ADJ_STEMS_KO)
    expect(VERB_STEMS_KO.filter((stem) => adj.has(stem))).toEqual([])
  })

  it('have no duplicate stems', () => {
    expect(new Set(VERB_STEMS_KO).size).toBe(VERB_STEMS_KO.length)
    expect(new Set(ADJ_STEMS_KO).size).toBe(ADJ_STEMS_KO.length)
  })

  it('hold bare stems: pure hangul, no 다, no ending attached', () => {
    for (const stem of [...VERB_STEMS_KO, ...ADJ_STEMS_KO]) {
      expect(stem).toMatch(/^[가-힣]+$/)
      expect(stem.endsWith('다')).toBe(false)
    }
  })

  it.each(['고르', '시키', '먹', '사', '만들', '추천하', '예약하'])(
    'covers the Task 4 residual verb stem %s',
    (stem) => {
      expect(VERB_STEMS_KO).toContain(stem)
    },
  )

  it.each(['유명하', '시원하', '저렴하', '간단하', '조용하'])(
    'covers the 하다-adjective stem %s',
    (stem) => {
      expect(ADJ_STEMS_KO).toContain(stem)
    },
  )
})
