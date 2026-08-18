import { describe, expect, it } from 'vitest'
import { tokenize } from '../engine/tokenizer'
import { findAmounts } from './amount'
import { findPeople } from './people'
import { findReference } from './reference'

function ref(input: string) {
  const hit = findReference(tokenize(input), input)
  return hit === null ? null : { ...hit.value, span: input.slice(hit.start, hit.end) }
}

describe('findReference — the brief\'s worked examples', () => {
  it.each([
    ['아까 그 술값에 민수도 껴줘', 'today', '술값', '아까 그 술값에'],
    ['어제 택시비 취소해줘', 'yesterday', '택시비', '어제 택시비'],
    ['그거 3만원으로 바꿔줘', 'recent', null, '그거'],
    // The span stops at the reference word itself: `expense` is a stopword,
    // so no keyword was consumed and none is claimed.
    ['remove that expense', 'recent', null, 'that'],
  ])('%s', (input, window, keyword, span) => {
    expect(ref(input)).toEqual({ window, keyword, span })
  })
})

describe('findReference — the closed window set', () => {
  it.each([
    ['아까 그 커피값 취소', 'today'],
    ['방금 저녁 취소해줘', 'today'],
    ['어제 술값 취소해줘', 'yesterday'],
    ['어저께 술값 취소해줘', 'yesterday'],
    ['그거 취소해줘', 'recent'],
    ['그것 취소해줘', 'recent'],
    ['그건 취소해줘', 'recent'],
    ['그걸 취소해줘', 'recent'],
    ['cancel that', 'recent'],
    ['cancel the one from earlier', 'today'],
    ["cancel yesterday's coffee", 'yesterday'],
  ])('%s -> %s', (input, window) => {
    expect(ref(input)?.window).toBe(window)
  })

  it('a sentence with no reference word yields no reference at all', () => {
    for (const input of [
      '민수도 껴줘',
      '택시 8500원 유나가 냄',
      '취소해줘',
      'remove Sam',
      '오늘 술값 얼마 썼어?',
    ]) {
      expect(ref(input), input).toBeNull()
    }
  })

  it('a word that merely STARTS with a reference surface is not a reference', () => {
    // 아까워 (an adjective) / 그거야말로 are not 아까 / 그거 — only a josa may
    // ride along, which is what `detachJosa` decides.
    expect(ref('아까워서 취소해줘')).toBeNull()
    expect(ref('어제부터 술값 취소해줘')?.window).toBe('yesterday')
    expect(ref('그거를 취소해줘')?.window).toBe('recent')
  })
})

describe('findReference — keyword extraction', () => {
  it('detaches the josa from the keyword noun', () => {
    expect(ref('아까 그 술값에 민수도 껴줘')?.keyword).toBe('술값')
    expect(ref('아까 술값은 취소해줘')?.keyword).toBe('술값')
    expect(ref('어제 이자카야 취소해줘')?.keyword).toBe('이자카야')
  })

  it('an action word after the reference is never the keyword', () => {
    expect(ref('아까 취소해줘')?.keyword).toBeNull()
    expect(ref('그거 지워줘')?.keyword).toBeNull()
    expect(ref('cancel that')?.keyword).toBeNull()
  })

  it('a generic stand-in for "the expense" is a stopword, not a keyword', () => {
    expect(ref('remove that expense')?.keyword).toBeNull()
    expect(ref('아까 그 지출 취소해줘')?.keyword).toBeNull()
  })

  it('a number after the reference is not a keyword', () => {
    expect(ref('그거 3만원으로 바꿔줘')?.keyword).toBeNull()
    expect(ref('make that 30 bucks')?.keyword).toBeNull()
  })

  it('reads across the English possessive and determiner frames', () => {
    expect(ref("cancel yesterday's taxi")?.keyword).toBe('taxi')
    expect(ref('cancel the one from earlier drinks')?.keyword).toBe('drinks')
  })

  it('a second reference word does not become the keyword', () => {
    expect(ref('어제 그거 취소해줘')).toEqual({
      window: 'yesterday',
      keyword: null,
      span: '어제',
    })
  })

  it('the span covers the reference word and its keyword together', () => {
    expect(ref('아까 그 술값에 민수도 껴줘')?.span).toBe('아까 그 술값에')
    expect(ref('그거 3만원으로 바꿔줘')?.span).toBe('그거')
  })
})

describe('findReference — a name between the reference and its noun', () => {
  it('skips a member span instead of taking it for the keyword', () => {
    const input = '아까 민수 술값에 유나도 껴줘'
    const tokens = tokenize(input)
    const people = findPeople(tokens, input, [
      { id: 'm1', name: '민수' },
      { id: 'm2', name: '유나' },
    ])
    expect(findReference(tokens, input, people)?.value).toEqual({
      window: 'today',
      keyword: '술값',
    })
  })

  it('without the member hits, the name is what the search finds first', () => {
    // Documents the cost of omitting `people`: the keyword is then 민수, which
    // matches no note and resolves to 'none' (the UI asks) — wrong, but never
    // a wrong EDIT.
    expect(ref('아까 민수 술값에 유나도 껴줘')?.keyword).toBe('민수')
  })
})

describe('findReference — a written amount between the reference and its noun', () => {
  const amountsOf = (input: string) =>
    findAmounts(tokenize(input), input, 'KRW')
  const refWithAmounts = (input: string) => {
    const tokens = tokenize(input)
    const hit = findReference(tokens, input, [], amountsOf(input))
    return hit === null ? null : hit.value
  }

  it('skips a Korean number-word span instead of taking it for the keyword', () => {
    // T10 mandate C: 삼만원 is what the expense is being changed TO. Taken as
    // the keyword it matches no note and forces a 'none'.
    expect(refWithAmounts('그거 삼만원으로 바꿔줘')).toEqual({
      window: 'recent',
      keyword: null,
    })
    // Leftmost reference wins (아까 → today); the 그거 behind it is the same
    // expense said twice, and 오만원 is still skipped rather than taken.
    expect(refWithAmounts('아까 그거 오만원으로 고쳐줘')).toEqual({
      window: 'today',
      keyword: null,
    })
  })

  it('without the amount hits, the number-word is what the search finds first', () => {
    // Documents the cost of omitting `amounts`, exactly as the `people`
    // counterpart above does.
    expect(ref('그거 삼만원으로 바꿔줘')?.keyword).toBe('삼만원')
  })

  it('a digit-written amount never needed the span list', () => {
    // The `digits` branch already ends the keyword search with no keyword,
    // with or without the amount hits.
    expect(refWithAmounts('그거 30000원으로 바꿔줘')).toEqual({
      window: 'recent',
      keyword: null,
    })
    expect(ref('그거 30000원으로 바꿔줘')?.keyword).toBeNull()
  })

  it('a real keyword still survives an amount later in the sentence', () => {
    expect(refWithAmounts('어제 택시비 삼만원으로 바꿔줘')).toEqual({
      window: 'yesterday',
      keyword: '택시비',
    })
  })
})

describe('findReference — english change frames name no category', () => {
  it.each(['set that to 40 dollars', 'update that to 40 dollars', 'change that to $30'])(
    '%s -> no keyword',
    (input) => {
      expect(ref(input)).toEqual({ window: 'recent', keyword: null, span: 'that' })
    },
  )
})
