import { describe, expect, it } from 'vitest'
import { tokenize } from '../engine/tokenizer'
import { findPayVerbs, findSplit, type ParseLocale } from './split'

function payVerbs(input: string, locale: ParseLocale = 'both') {
  return findPayVerbs(tokenize(input), input, locale).map((h) => ({
    stem: h.value.stem,
    span: input.slice(h.start, h.end),
    confidence: h.confidence,
  }))
}

function splits(input: string) {
  return findSplit(tokenize(input), input).map((h) => ({
    ...h.value,
    span: input.slice(h.start, h.end),
  }))
}

describe('findPayVerbs — korean', () => {
  it.each([
    ['계산했어', '계산', '계산했어'],
    ['내가 계산할게', '계산', '계산할게'],
    ['민수가 쐈다', '쐈', '쐈다'],
    ['어제 결제했어', '결제', '결제했어'],
    ['카드로 긁었어', '긁었', '긁었어'],
    ['내가 사줬어', '사줬', '사줬어'],
    ['저녁 샀는데', '샀', '샀는데'],
    ['어제 냈고', '냈', '냈고'],
    ['이번엔 내가 쏠게', '쏘', '쏠게'],
    ['지불했어요', '지불', '지불했어요'],
  ])('%s -> %s', (input, stem, span) => {
    expect(payVerbs(input)[0]).toMatchObject({ stem, span })
  })

  // 으-mediated endings and the future attributive — parity with the regex
  // this parser replaces, which matched every one of these.
  it.each([
    ['냈으니까 미안', '냈', '냈으니까'],
    ['냈을 때 말했어', '냈', '냈을'],
    ['샀으니까 괜찮아', '샀', '샀으니까'],
    ['냈으면 좋겠어', '냈', '냈으면'],
    ['냈을걸', '냈', '냈을걸'],
    ['냈으며', '냈', '냈으며'],
    ['사줬으면 좋겠다', '사줬', '사줬으면'],
  ])('%s -> %s', (input, stem, span) => {
    expect(payVerbs(input)[0]).toMatchObject({ stem, span })
  })

  // Backlog #2: a verbal noun is only a verb once a 하-suffix verbalizes it.
  it.each(['계산서 좀 줘', '계산기 어디 있어', '계산대 앞에서 봐', '결제일 언제야'])(
    '%s has no pay verb',
    (input) => {
      expect(payVerbs(input)).toEqual([])
    },
  )

  it('a bare verbal noun still reports, at lower confidence', () => {
    expect(payVerbs('계산 누가 해')[0]).toMatchObject({ stem: '계산', confidence: 0.6 })
  })

  it('leaves a glued noun outside the verb span', () => {
    expect(payVerbs('저녁계산했어')[0]).toMatchObject({ stem: '계산', span: '계산했어' })
  })

  it('has no pay verb in a request to be included in the split', () => {
    expect(payVerbs('나도 껴줘')).toEqual([])
  })

  it('finds every pay verb in the sentence', () => {
    expect(payVerbs('민수가 계산했고 유나가 쐈어').map((h) => h.stem)).toEqual(['계산', '쐈'])
  })
})

describe('findPayVerbs — english', () => {
  it.each([
    ['I paid', 'paid'],
    ['minsu picked up the tab', 'picked up the tab'],
    ['she covered it', 'covered'],
    ['we chipped in', 'chipped in'],
    ['he fronted the deposit', 'fronted'],
    ['yuna spotted me', 'spotted'],
    ['I bought lunch', 'bought'],
  ])('%s -> %s', (input, stem) => {
    expect(payVerbs(input)[0]).toMatchObject({ stem })
  })

  it('never fires inside a longer word', () => {
    expect(payVerbs('tabloid')).toEqual([])
    expect(payVerbs('unpaid invoice')).toEqual([])
  })

  it('spans the whole phrase', () => {
    expect(payVerbs('minsu picked up the tab yesterday')[0].span).toBe('picked up the tab')
  })

  it('reports the ambiguous "got it" at lower confidence', () => {
    expect(payVerbs('I got it')[0]).toMatchObject({ stem: 'got it', confidence: 0.6 })
  })
})

describe('findPayVerbs — locale', () => {
  it('scans only the requested language', () => {
    expect(payVerbs('민수가 paid 했어', 'ko').map((h) => h.stem)).toEqual([])
    expect(payVerbs('민수가 paid 했어', 'en').map((h) => h.stem)).toEqual(['paid'])
    expect(payVerbs('민수가 계산했어 and I paid', 'both').map((h) => h.stem)).toEqual([
      '계산',
      'paid',
    ])
  })
})

describe('findSplit', () => {
  it.each([
    ['엔빵하자', 'everyone', '엔빵'],
    ['n빵', 'everyone', 'n빵'],
    ['다같이 먹었어', 'everyone', '다같이'],
    ['다 같이 먹었어', 'everyone', '다 같이'],
    ['모두 나눠서', 'everyone', '모두'],
    ['전부 다 계산했어', 'everyone', '전부'],
    ['나누자', 'everyone', '나누자'],
    ['반반', 'half', '반반'],
    ['절반씩 내자', 'half', '절반'],
    ['split it', 'everyone', 'split'],
    ['evenly please', 'everyone', 'evenly'],
    ['everyone joins', 'everyone', 'everyone'],
    ['all together now', 'everyone', 'all together'],
    ['half and half', 'half', 'half'],
    ['we went dutch', 'everyone', 'went dutch'],
    ['we went halves', 'half', 'went halves'],
  ])('%s -> %s', (input, mode, span) => {
    expect(splits(input)[0]).toMatchObject({ mode, span })
  })

  it('reads an n-ways split as a number plus "ways"', () => {
    expect(splits('split three ways')).toEqual([
      { mode: 'n-ways', n: 3, span: 'split three ways' },
    ])
    expect(splits('split it 4 ways').at(-1)).toMatchObject({ mode: 'n-ways', n: 4 })
    expect(splits('seventeen ways')[0]).toMatchObject({ mode: 'n-ways', n: 17 })
    expect(splits('three way split')[0]).toMatchObject({ mode: 'n-ways', n: 3 })
  })

  // A one-way split is not a split; "one way street" is ordinary English.
  it.each(['one way street', '1 way', 'one way or another'])('%s is not a split', (input) => {
    expect(splits(input)).toEqual([])
  })

  it('tolerates any whitespace inside a spaced entry', () => {
    expect(splits('다  같이 먹었어')[0]).toMatchObject({ mode: 'everyone', span: '다  같이' })
    expect(splits('다\n같이 먹었어')[0]).toMatchObject({ mode: 'everyone' })
  })

  // "split it three ways" is deliberately TWO hits — the caller (Task 8)
  // reconciles a sentence's split hits against the names it found.
  it('emits both hits when the split word is not adjacent to the count', () => {
    expect(splits('split it three ways').map((h) => h.mode)).toEqual(['everyone', 'n-ways'])
  })

  // Product ruling (index.ts, coordinator 2026-08-09): bare 같이 is NOT a
  // split keyword — "민수랑 같이 저녁 3만원" is a two-person split, not
  // everyone.
  it('never fires on bare 같이', () => {
    expect(splits('민수랑 같이 저녁 먹었어')).toEqual([])
  })

  it('has no split keyword in a request to be included', () => {
    expect(splits('나도 껴줘')).toEqual([])
  })

  it('reports each expression once, with exact spans', () => {
    expect(splits('저녁 반반 하고 커피는 엔빵')).toEqual([
      { mode: 'half', span: '반반' },
      { mode: 'everyone', span: '엔빵' },
    ])
  })
})

describe('span discipline (backlog #5)', () => {
  it('covers the full inflected verb form so nothing is left behind', () => {
    // The 결제했어 → "…어" artifact the old NOISE regex left in descriptions
    // (pinned in index.test.ts as "물어보고 어") is impossible here: the hit's
    // own span already reaches the end of the inflected form.
    const input = '민수한테 물어보고 결제했어'
    const hits = findPayVerbs(tokenize(input), input, 'ko')
    expect(hits).toHaveLength(1)
    expect(input.slice(hits[0].start, hits[0].end)).toBe('결제했어')
    const scrubbed = (input.slice(0, hits[0].start) + input.slice(hits[0].end)).trim()
    expect(scrubbed).toBe('민수한테 물어보고')
  })

  it('leaves 나도 untouched — no hit claims it', () => {
    const input = '나도 껴줘'
    const claimed = [
      ...findPayVerbs(tokenize(input), input, 'both'),
      ...findSplit(tokenize(input), input),
    ]
    expect(claimed).toEqual([])
    expect(input.slice(0, 2)).toBe('나도')
  })
})
