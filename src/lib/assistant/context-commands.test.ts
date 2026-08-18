import { describe, expect, it } from 'vitest'
import {
  expandKeyword,
  noteMatchesKeyword,
  resolveReference,
  type RecentExpenseLite,
} from './context-commands'
import { CATEGORY_SYNONYMS } from './lexicons/categories'

/** KST, as `Date#getTimezoneOffset()` reports it (minutes WEST of UTC). */
const KST = -540

/** 2026-08-13 09:00 KST — the "now" every case below is resolved against. */
const NOW = new Date('2026-08-13T00:00:00Z')

/** A local wall-clock time in KST, as an instant. */
function kst(day: number, hour: number): Date {
  return new Date(Date.UTC(2026, 7, day, hour - 9, 0))
}

function expense(
  id: string,
  note: string,
  timestamp: Date,
  overrides: Partial<RecentExpenseLite> = {},
): RecentExpenseLite {
  return {
    id,
    note,
    amountMinor: 30000n,
    currency: 'KRW',
    timestamp,
    participantIds: ['me', 'm1'],
    payerId: 'me',
    cancelled: false,
    ...overrides,
  }
}

describe('resolveReference — exactly one survivor', () => {
  const today = [
    expense('e1', '이자카야', kst(13, 21)),
    expense('e2', '점심 김치찌개', kst(13, 12)),
    expense('e3', '', kst(13, 8)),
  ]

  it('a category keyword finds the note through the synonym table', () => {
    const result = resolveReference(
      { window: 'today', keyword: '술값' },
      today,
      NOW,
      KST,
    )
    expect(result.outcome).toBe('one')
    expect(result.candidates.map((c) => c.id)).toEqual(['e1'])
  })

  it('a keyword that matches the note directly needs no synonym at all', () => {
    const result = resolveReference(
      { window: 'today', keyword: '김치찌개' },
      today,
      NOW,
      KST,
    )
    expect(result.outcome).toBe('one')
    expect(result.candidates.map((c) => c.id)).toEqual(['e2'])
  })

  it('a note-less expense never matches a keyword', () => {
    expect(
      resolveReference({ window: 'today', keyword: '노래방' }, today, NOW, KST)
        .outcome,
    ).toBe('none')
  })
})

describe('resolveReference — ambiguity is asked about, never guessed', () => {
  it("two 술-ish notes yield 'many' with both", () => {
    const today = [
      expense('e1', '이자카야', kst(13, 21)),
      expense('e2', '맥주 2차', kst(13, 23)),
      expense('e3', '점심', kst(13, 12)),
    ]
    const result = resolveReference(
      { window: 'today', keyword: '술값' },
      today,
      NOW,
      KST,
    )
    expect(result.outcome).toBe('many')
    // Newest first.
    expect(result.candidates.map((c) => c.id)).toEqual(['e2', 'e1'])
  })

  it("a 'many' list is capped at the newest five", () => {
    const many = Array.from({ length: 8 }, (_, i) =>
      expense(`e${i}`, `커피 ${i}`, kst(13, 9 + i)),
    )
    const result = resolveReference(
      { window: 'today', keyword: '커피' },
      many,
      NOW,
      KST,
    )
    expect(result.outcome).toBe('many')
    expect(result.candidates.map((c) => c.id)).toEqual([
      'e7',
      'e6',
      'e5',
      'e4',
      'e3',
    ])
  })

  it("a keyword with zero matches yields 'none' with the newest five overall", () => {
    const expenses = Array.from({ length: 7 }, (_, i) =>
      expense(`e${i}`, `밥 ${i}`, kst(10 + Math.floor(i / 3), 9 + i)),
    )
    const result = resolveReference(
      { window: 'today', keyword: '술값' },
      expenses,
      NOW,
      KST,
    )
    expect(result.outcome).toBe('none')
    expect(result.candidates).toHaveLength(5)
    // The fallback ignores the window entirely — it is the "is it one of
    // these?" list, and the window is exactly what found nothing.
    expect(result.candidates.map((c) => c.id)).toEqual([
      'e6',
      'e5',
      'e4',
      'e3',
      'e2',
    ])
  })

  it("an empty group yields 'none' with an empty list", () => {
    expect(resolveReference({ window: 'recent', keyword: null }, [], NOW, KST)).toEqual(
      { outcome: 'none', candidates: [] },
    )
  })
})

describe('resolveReference — windows are device-local days', () => {
  const expenses = [
    expense('today-late', '이자카야', kst(13, 1)),
    expense('yesterday', '이자카야', kst(12, 21)),
    expense('older', '이자카야', kst(9, 21)),
  ]

  it('the yesterday window excludes today’s rows', () => {
    const result = resolveReference(
      { window: 'yesterday', keyword: '술값' },
      expenses,
      NOW,
      KST,
    )
    expect(result.outcome).toBe('one')
    expect(result.candidates.map((c) => c.id)).toEqual(['yesterday'])
  })

  it('the today window excludes yesterday’s rows', () => {
    const result = resolveReference(
      { window: 'today', keyword: '술값' },
      expenses,
      NOW,
      KST,
    )
    expect(result.outcome).toBe('one')
    expect(result.candidates.map((c) => c.id)).toEqual(['today-late'])
  })

  it('01:00 KST is TODAY even though it is still yesterday in UTC', () => {
    // The Phase 3C bug in one assertion: with a UTC offset the same instant
    // falls on the previous day, and the reference would resolve to a
    // different expense.
    const utc = resolveReference(
      { window: 'today', keyword: '술값' },
      expenses,
      NOW,
      0,
    )
    expect(utc.candidates.map((c) => c.id)).not.toEqual(['today-late'])
  })

  it("the recent window ignores days and takes the newest 20", () => {
    const many = Array.from({ length: 25 }, (_, i) =>
      expense(`e${i}`, i === 0 ? '이자카야' : `밥 ${i}`, kst(1, 1 + i)),
    )
    // e0 is the oldest row and the only 술 note — outside the newest 20, so
    // the reference does not reach it.
    expect(
      resolveReference({ window: 'recent', keyword: '술값' }, many, NOW, KST)
        .outcome,
    ).toBe('none')
    expect(
      resolveReference({ window: 'recent', keyword: '밥' }, many, NOW, KST)
        .candidates,
    ).toHaveLength(5)
  })
})

describe('resolveReference — cancelled expenses are always excluded', () => {
  const expenses = [
    expense('cancelled', '이자카야', kst(13, 21), { cancelled: true }),
    expense('live', '점심', kst(13, 12)),
  ]

  it('a cancelled row is never a match', () => {
    expect(
      resolveReference({ window: 'today', keyword: '술값' }, expenses, NOW, KST),
    ).toEqual({ outcome: 'none', candidates: [expenses[1]] })
  })

  it('a cancelled row is not offered in the fallback list either', () => {
    const result = resolveReference(
      { window: 'yesterday', keyword: null },
      expenses,
      NOW,
      KST,
    )
    expect(result.outcome).toBe('none')
    expect(result.candidates.map((c) => c.id)).toEqual(['live'])
  })
})

describe('resolveReference — a keyword-less reference is the plain window', () => {
  it('exactly one expense in the window resolves with no keyword at all', () => {
    const expenses = [expense('e1', '이자카야', kst(13, 21))]
    expect(
      resolveReference({ window: 'recent', keyword: null }, expenses, NOW, KST),
    ).toEqual({ outcome: 'one', candidates: expenses })
  })
})

describe('category synonyms', () => {
  it('expands a Korean compound through its category head', () => {
    expect(expandKeyword('술값')).toContain('이자카야')
    expect(expandKeyword('택시비')).toContain('taxi')
    expect(expandKeyword('커피')).toContain('cafe')
  })

  it('does not expand a word that merely CONTAINS a category surface', () => {
    // 기술 contains 술 but is not a drink — prefix matching is what keeps the
    // table from firing on unrelated compounds.
    expect(expandKeyword('기술')).toEqual(['기술'])
  })

  it('an unknown keyword expands to itself alone', () => {
    expect(expandKeyword('세차')).toEqual(['세차'])
  })

  it('latin surfaces match a note on a word boundary, korean as substring', () => {
    expect(noteMatchesKeyword('Vegas trip', 'gas')).toBe(false)
    expect(noteMatchesKeyword('gas station', '주유')).toBe(true)
    expect(noteMatchesKeyword('이자카야 2차', '술')).toBe(true)
  })

  it('matching is case-insensitive', () => {
    expect(noteMatchesKeyword('Izakaya night', '술값')).toBe(true)
  })

  it('no surface appears in two different groups', () => {
    const owner = new Map<string, number>()
    CATEGORY_SYNONYMS.forEach((group, index) => {
      for (const term of group) {
        const existing = owner.get(term)
        expect(
          existing === undefined || existing === index,
          `"${term}" appears in groups ${existing} and ${index}`,
        ).toBe(true)
        owner.set(term, index)
      }
    })
    expect(owner.size).toBeGreaterThan(0)
  })

  it('every surface is NFC-normalized and lower-case', () => {
    for (const term of CATEGORY_SYNONYMS.flat()) {
      expect(term, `"${term}" is not NFC-normalized`).toBe(term.normalize('NFC'))
      expect(term).toBe(term.toLowerCase())
    }
  })
})

describe('a korean category surface must start a hangul run', () => {
  // Review fix round 1, item 1: a bare substring match made 술 fire inside
  // 미술관/기술/예술, and a single such note is enough to become the ONE
  // survivor of "아까 그 술값" — an edit applied to an unrelated expense,
  // without ever being questioned. This is the regression floor for that.
  it.each(['미술관 입장료', '기술 지원비', '예술의전당 공연'])(
    '%s does not match the keyword 술값',
    (note) => {
      expect(noteMatchesKeyword(note, '술값')).toBe(false)
      expect(noteMatchesKeyword(note, '술')).toBe(false)
    },
  )

  it.each(['술값', '술 마심', '이자카야 2차', '2차 술자리'])(
    '%s still matches',
    (note) => {
      expect(noteMatchesKeyword(note, '술값')).toBe(true)
    },
  )

  it.each(['미술관 입장료', '기술 지원비', '예술의전당 공연'])(
    "a sole %s note resolves to 'none', never to 'one'",
    (note) => {
      const result = resolveReference(
        { window: 'today', keyword: '술값' },
        [expense('e1', note, kst(13, 19))],
        NOW,
        KST,
      )
      expect(result.outcome).toBe('none')
      // The fallback still offers it — it is a real recent expense, just not
      // a confident match.
      expect(result.candidates.map((c) => c.id)).toEqual(['e1'])
    },
  )

  it('with a real 술 note present, the decoys are not listed alongside it', () => {
    const result = resolveReference(
      { window: 'today', keyword: '술값' },
      [
        expense('art', '미술관 입장료', kst(13, 14)),
        expense('tech', '기술 지원비', kst(13, 15)),
        expense('drinks', '이자카야', kst(13, 21)),
      ],
      NOW,
      KST,
    )
    expect(result.outcome).toBe('one')
    expect(result.candidates.map((c) => c.id)).toEqual(['drinks'])
  })
})
