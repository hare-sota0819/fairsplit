import { readdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

import { CONFIRM_TOKENS } from './confirm'
import { HELP_CORPUS, MODIFY_CORPUS, QUERY_CORPUS } from './corpus'
import { D7_SETTLE_PROGRESS_SUBJECTS, DECOY_PHRASES } from './decoy-phrases'
import { GUARD_PAIRS } from './guard'
import { HELP_MARKERS } from './help'
import { HOLD_TOKENS } from './hold'
import { MODIFY_PATTERNS } from './modify'
import { NEGATE_TOKENS } from './negate'
import { NEITHER_TOKENS } from './neither'
import { QUERY_MARKERS } from './query'

const DIR = dirname(fileURLToPath(import.meta.url))

/**
 * The "vocabulary" families classify() (T3) will actually branch on — the
 * ones a token/marker classification ambiguity is a real bug in. `corpus.ts`
 * is deliberately excluded: it holds full attested SENTENCES for T3/T4's
 * test tables, not vocabulary, so a corpus row equaling (or containing) a
 * marker from the family it's fixture data FOR is expected, not a collision.
 */
const VOCAB_FAMILIES: ReadonlyArray<{
  name: string
  surfaces: ReadonlyArray<{ locale: 'ko' | 'en'; text: string }>
}> = [
  {
    name: 'CONFIRM_TOKENS',
    surfaces: CONFIRM_TOKENS.map((e) => ({ locale: e.locale, text: e.token })),
  },
  {
    name: 'NEGATE_TOKENS',
    surfaces: NEGATE_TOKENS.map((e) => ({ locale: e.locale, text: e.token })),
  },
  {
    name: 'MODIFY_PATTERNS',
    surfaces: MODIFY_PATTERNS.map((e) => ({
      locale: e.locale,
      text: e.pattern,
    })),
  },
  {
    name: 'QUERY_MARKERS',
    surfaces: QUERY_MARKERS.map((e) => ({ locale: e.locale, text: e.marker })),
  },
  {
    name: 'HELP_MARKERS',
    surfaces: HELP_MARKERS.map((e) => ({ locale: e.locale, text: e.marker })),
  },
  {
    name: 'HOLD_TOKENS',
    surfaces: HOLD_TOKENS.map((e) => ({ locale: e.locale, text: e.token })),
  },
  {
    name: 'NEITHER_TOKENS',
    surfaces: NEITHER_TOKENS.map((e) => ({ locale: e.locale, text: e.token })),
  },
  {
    name: 'DECOY_PHRASES',
    surfaces: DECOY_PHRASES.map((e) => ({ locale: e.locale, text: e.phrase })),
  },
]

/**
 * The collision check below is intentionally LOCALE-AGNOSTIC (keyed by
 * surface text alone, ignoring `locale`): spec §6#5 has both the ko and en
 * lexicons loaded at once (a group can mix languages across members), so a
 * same-spelled collision between an en marker and a ko marker is just as
 * real a classification ambiguity as a same-locale one — scoping the check
 * to one locale at a time would silently miss that case.
 *
 * Two known, intentional reuses survive this stricter check:
 *
 * `다같이` is both a MODIFY_PATTERNS split marker (spec §2.4's exact list)
 * and a QUERY_MARKERS group-total marker (spec §2.5 step 4). Safe for two
 * stacked reasons, not just ladder order: CONFIRM_MODIFY is only reachable
 * at all when `ctx.openCard !== null` (spec §2.2), P2 before P3 (spec
 * §2.3) — AND §2.4's fragment gate itself decides whether P2 claims the
 * message. A BARE `다같이` (nothing else) is a fragment → MODIFY. `다같이`
 * embedded in a longer sentence that survives the amount/member/split-
 * keyword strip (`다같이 쓴 돈 총 얼마야`) is NOT a fragment, so P2 declines
 * it and it falls through to P3/QUERY instead — the same mechanism spec's
 * own §3.4 NEGATIVE row proves for a sibling split keyword: `숙소비 15만원
 * 다같이` survives `숙소비` and becomes a new EXPENSE_ENTRY, not a
 * CONFIRM_MODIFY, even with a card open. `반반`/`n빵`/`엔빵` ride the exact
 * same fragment-gate protection (bare → MODIFY fragment; embedded in a
 * longer non-fragment sentence → falls through) even though no other
 * family currently reuses those specific words.
 *
 * en `scratch that` is both a NEGATE_TOKENS whole-input token and a
 * MODIFY_PATTERNS correction-frame marker. Safe for the mirror reason:
 * NEGATE_TOKENS matches via P1's WHOLE-INPUT equality (spec §2.3), checked
 * before P2. A bare "scratch that" (nothing else) matches P1 and cancels;
 * "scratch that, 50" is not equal to the bare token, so P1 does not fire,
 * and P2's substring/frame match correctly reads it as a correction
 * instead.
 *
 * Any OTHER cross-family collision is still a real bug and must fail here.
 */
const KNOWN_SAFE_CROSS_FAMILY_REUSE = new Set(['다같이', 'scratch that'])

describe('lexicon structural invariants', () => {
  it('(a) no vocabulary surface string appears in two different families (locale-agnostic — §6#5 loads both), except the documented openCard-gated exceptions', () => {
    const owner = new Map<string, string>() // text -> family name

    for (const family of VOCAB_FAMILIES) {
      for (const { text } of family.surfaces) {
        const existing = owner.get(text)
        if (
          existing !== undefined &&
          existing !== family.name &&
          !KNOWN_SAFE_CROSS_FAMILY_REUSE.has(text)
        ) {
          throw new Error(
            `"${text}" appears in both ${existing} and ${family.name}`,
          )
        }
        owner.set(text, family.name)
      }
    }

    expect(owner.size).toBeGreaterThan(0)
  })

  it('(a2) no exact-duplicate row within a single family', () => {
    // Dedup keys differ per family because some families legitimately repeat
    // a surface string under a different discriminator (QUERY_MARKERS: same
    // marker under a different intent+role, e.g. `얼마`/`owe`; NEITHER_TOKENS:
    // same token under a different `context`). A true accidental duplicate —
    // identical key twice — is still a copy-paste bug.
    function assertNoDup(name: string, keys: readonly string[]) {
      const seen = new Set<string>()
      for (const key of keys) {
        if (seen.has(key)) throw new Error(`${name}: duplicate row "${key}"`)
        seen.add(key)
      }
    }

    assertNoDup(
      'CONFIRM_TOKENS',
      CONFIRM_TOKENS.map((e) => `${e.locale}::${e.token}`),
    )
    assertNoDup(
      'NEGATE_TOKENS',
      NEGATE_TOKENS.map((e) => `${e.locale}::${e.token}`),
    )
    assertNoDup(
      'MODIFY_PATTERNS',
      MODIFY_PATTERNS.map((e) => `${e.locale}::${e.pattern}`),
    )
    assertNoDup(
      'QUERY_MARKERS',
      QUERY_MARKERS.map(
        (e) => `${e.locale}::${e.intent}::${e.role}::${e.marker}`,
      ),
    )
    assertNoDup(
      'HELP_MARKERS',
      HELP_MARKERS.map((e) => `${e.locale}::${e.marker}`),
    )
    assertNoDup(
      'HOLD_TOKENS',
      HOLD_TOKENS.map((e) => `${e.locale}::${e.token}`),
    )
    assertNoDup(
      'NEITHER_TOKENS',
      NEITHER_TOKENS.map((e) => `${e.locale}::${e.context}::${e.token}`),
    )
    assertNoDup(
      'MODIFY_CORPUS',
      MODIFY_CORPUS.map((e) => `${e.locale}::${e.pattern}`),
    )
    assertNoDup(
      'QUERY_CORPUS',
      QUERY_CORPUS.map((e) => `${e.locale}::${e.intent}::${e.input}`),
    )
    assertNoDup(
      'HELP_CORPUS',
      HELP_CORPUS.map((e) => `${e.locale}::${e.input}`),
    )
    assertNoDup(
      'DECOY_PHRASES',
      DECOY_PHRASES.map((e) => `${e.locale}::${e.phrase}`),
    )
    // Final-review minor batch: T4's own note (STATUS.md) flagged
    // `D7_SETTLE_PROGRESS_SUBJECTS` as never covered by these invariants —
    // this closes the dedup leg of that gap.
    assertNoDup('D7_SETTLE_PROGRESS_SUBJECTS', D7_SETTLE_PROGRESS_SUBJECTS)
  })

  it('(b) every surface string is NFC-normalized', () => {
    const allStrings: string[] = [
      ...CONFIRM_TOKENS.map((e) => e.token),
      ...NEGATE_TOKENS.map((e) => e.token),
      ...MODIFY_PATTERNS.map((e) => e.pattern),
      ...QUERY_MARKERS.map((e) => e.marker),
      ...HELP_MARKERS.map((e) => e.marker),
      ...HOLD_TOKENS.map((e) => e.token),
      ...NEITHER_TOKENS.map((e) => e.token),
      ...MODIFY_CORPUS.map((e) => e.pattern),
      ...QUERY_CORPUS.map((e) => e.input),
      ...HELP_CORPUS.map((e) => e.input),
      ...DECOY_PHRASES.map((e) => e.phrase),
      ...GUARD_PAIRS.flatMap((p) => [p.outer, p.inner]),
      ...D7_SETTLE_PROGRESS_SUBJECTS,
    ]
    for (const s of allStrings) {
      expect(s, `"${s}" is not NFC-normalized`).toBe(s.normalize('NFC'))
    }
  })

  it('(c) every §2.7 token-boundary substring pair (plus the round-2/round-3 additions) is present in GUARD_PAIRS', () => {
    const expected = [
      // spec §2.7
      { outer: 'ㄴㅇㅈ', inner: 'ㅇㅈ' },
      { outer: 'unsure', inner: 'sure' },
      { outer: 'not sure', inner: 'sure' },
      { outer: 'no problem', inner: 'no' },
      // round 2
      { outer: 'ㄴㅇㅈ', inner: 'ㅇ' },
      { outer: '민수 빼줘', inner: '빼' },
      { outer: '아니 그게 아니라', inner: '아니' },
      { outer: 'scratch that, 50', inner: 'scratch that' },
      { outer: 'wait no, 50', inner: 'wait' },
      { outer: '얼마예요', inner: '예' },
      // round 3
      { outer: '빼줘', inner: '빼' },
      { outer: '헐 아니', inner: '아니' },
      { outer: 'ㅎㅇ', inner: 'ㅇ' },
      { outer: 'ㅇㅎ', inner: 'ㅇ' },
      { outer: "I'm not sure", inner: 'sure' },
      { outer: '헐 아니', inner: '헐' },
      { outer: '맞음', inner: '음' },
      // T3 (optional nit from T2's review)
      { outer: '아니라', inner: '아니' },
      { outer: '아니고', inner: '아니' },
    ]
    for (const pair of expected) {
      expect(GUARD_PAIRS).toContainEqual(pair)
    }
    expect(GUARD_PAIRS.length).toBe(expected.length)

    // Sanity: every guard pair really is a substring trap, not a stray row.
    for (const { outer, inner } of GUARD_PAIRS) {
      expect(
        outer.includes(inner),
        `"${outer}" does not contain "${inner}"`,
      ).toBe(true)
    }

    // Stronger sanity: every `inner` is a real token that lives somewhere in
    // the vocabulary families (CONFIRM/NEGATE/HOLD/NEITHER) — proving each
    // guard pair documents an ACTUAL collision risk, not a decorative
    // example. NEITHER_TOKENS is included per round 3: `헐`/`음` (the
    // `헐 아니`⊃`헐` and `맞음`⊃`음` pairs) are NEITHER_TOKENS entries, not
    // CONFIRM/NEGATE/HOLD ones.
    const realTokens = new Set<string>([
      ...CONFIRM_TOKENS.map((e) => e.token),
      ...NEGATE_TOKENS.map((e) => e.token),
      ...HOLD_TOKENS.map((e) => e.token),
      ...NEITHER_TOKENS.map((e) => e.token),
    ])
    for (const { inner } of GUARD_PAIRS) {
      expect(
        realTokens.has(inner),
        `guard inner "${inner}" is not a real CONFIRM/NEGATE/HOLD/NEITHER token`,
      ).toBe(true)
    }
  })

  it('(d) no regex literal anywhere in the lexicon data files', () => {
    const dataFiles = readdirSync(DIR).filter(
      (f) => f.endsWith('.ts') && !f.endsWith('.test.ts'),
    )
    expect(dataFiles.length).toBeGreaterThan(0)
    for (const file of dataFiles) {
      const src = readFileSync(join(DIR, file), 'utf8')
      // Strip comments and string/template literals, leaving only "code".
      // A bare "/" surviving that strip can only be a regex literal or a
      // division operator — neither belongs in these DATA-only files.
      // Double-quoted/template strings are stripped BEFORE single-quoted
      // ones: an apostrophe inside a double-quoted string (e.g. "it's")
      // would otherwise look like a stray single-quote delimiter and throw
      // off the pairing for everything that follows it.
      const stripped = src
        .replace(/\/\/[^\n]*/g, '')
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/"(?:[^"\\]|\\.)*"/g, '""')
        .replace(/`(?:[^`\\]|\\.)*`/g, '``')
        .replace(/'(?:[^'\\]|\\.)*'/g, "''")
      expect(
        stripped.includes('/'),
        `${file} appears to contain a regex literal or division operator`,
      ).toBe(false)
      expect(src.includes('RegExp')).toBe(false)
    }
  })

  it('(e) vocabulary marker files hold their authored row counts (mass-deletion guard)', () => {
    function counts(
      entries: ReadonlyArray<{ locale: 'ko' | 'en'; tier?: 'main' | 'exp' }>,
    ) {
      return {
        koMain: entries.filter((e) => e.locale === 'ko' && e.tier === 'main')
          .length,
        koExp: entries.filter((e) => e.locale === 'ko' && e.tier === 'exp')
          .length,
        enMain: entries.filter((e) => e.locale === 'en' && e.tier === 'main')
          .length,
        enExp: entries.filter((e) => e.locale === 'en' && e.tier === 'exp')
          .length,
      }
    }

    // TASK 11 SANCTIONED INCREMENT (fix round 1, controller ruling): koMain
    // 19 -> 20 (껴줘, the spoken form of 포함, which the saved-expense edit
    // parser already knew) and enMain 18 -> 20 ("change the amount to" /
    // "change the amount", the field-NAMED siblings of the "change it to" /
    // "make it" forms that already existed — naming the field used to get the
    // user LESS than not naming it). This pin is a mass-DELETION guard: a
    // commented, deliberate increment keeps that purpose intact.
    expect(counts(MODIFY_PATTERNS)).toEqual({
      koMain: 20,
      koExp: 4,
      enMain: 20,
      enExp: 0,
    })
    expect(counts(QUERY_MARKERS)).toEqual({
      // T4 additions: pairwiseNegatedFrame (안 냈/안 보냈), whoFrame
      // (누구한테/누구 계좌), aheadFrame/consumedFrame (더 낸/더 냈/항목별,
      // round-2 review I4 narrowed 더→더 낸/더 냈 to fix a 더치페이
      // collision — net +1 row), groupMarker/amountWord closure fixes
      // (내역/합계 x2/다 합쳐서), paidVerb closure fixes (지출/부담),
      // balancePayFrame closure fixes (내는/드리면/청구) — see
      // classify.test.ts/query.ts's T4 comments.
      koMain: 50,
      koExp: 13,
      // T3 addition: `the total` groupMarker (closes the en `what's the
      // total` reachability gap T2's own round-4 notes named — spec §3.1
      // NEGATIVE requires this row to classify as QUERY_GROUP_TOTAL). T4
      // additions: pairwiseNegatedFrame (pay me back/paid me back),
      // transfersFrame (who owes), whoFrame (who do I/who should I/zelle
      // who), lowercase `i` firstPerson (attested corpus casing).
      enMain: 34,
      enExp: 3,
    })
    expect(counts(HELP_MARKERS)).toEqual({
      // T4 addition: the 어떻게 cluster (어떻게 확인/어떻게 쓰는/어떻게
      // 써) T2's own header explicitly deferred to T4.
      koMain: 8,
      koExp: 5,
      enMain: 8,
      enExp: 0,
    })
    expect(HOLD_TOKENS.length).toBe(8)
    expect(NEITHER_TOKENS.length).toBe(38)
    // T4 addition: §2.6/§6's ruled-always-UNKNOWN phrase markers (D-7
    // 정산 진행 상태, 모임통장/회비, denomination/budget/conversion
    // questions, one en thin-signal ambiguity).
    expect(DECOY_PHRASES.length).toBe(13)
    // Final-review minor batch: T4's own note flagged this array as never
    // covered by a mass-deletion guard either — the §2.6 "정산 얼마 남았어"
    // worked example names exactly these 4 subject words (다들 is covered
    // separately by the broader '다들 정산' DECOY_PHRASES row above).
    expect(D7_SETTLE_PROGRESS_SUBJECTS.length).toBe(4)
  })

  it('(e2) the §3 attested corpus (corpus.ts) holds spec-exact row counts (mass-deletion guard)', () => {
    function counts(
      entries: ReadonlyArray<{ locale: 'ko' | 'en'; tier: 'main' | 'exp' }>,
    ) {
      return {
        koMain: entries.filter((e) => e.locale === 'ko' && e.tier === 'main')
          .length,
        koExp: entries.filter((e) => e.locale === 'ko' && e.tier === 'exp')
          .length,
        enMain: entries.filter((e) => e.locale === 'en' && e.tier === 'main')
          .length,
        enExp: entries.filter((e) => e.locale === 'en' && e.tier === 'exp')
          .length,
      }
    }

    // spec §"Row counts": table 3.4 CONFIRM_MODIFY
    expect(counts(MODIFY_CORPUS)).toEqual({
      koMain: 32,
      koExp: 8,
      enMain: 24,
      enExp: 0,
    })
    // table 3.10 HELP
    expect(counts(HELP_CORPUS)).toEqual({
      koMain: 16,
      koExp: 5,
      enMain: 9,
      enExp: 0,
    })

    // QUERY_CORPUS spans tables 3.5-3.9; check per intent against each
    // table's own row-count row, plus the overall total.
    const byIntent = (intent: string) =>
      QUERY_CORPUS.filter((e) => e.intent === intent)

    expect(counts(byIntent('QUERY_MY_BALANCE'))).toEqual({
      koMain: 29,
      koExp: 7,
      enMain: 16,
      enExp: 4,
    })
    expect(counts(byIntent('QUERY_PAIRWISE'))).toEqual({
      koMain: 26,
      koExp: 3,
      enMain: 15,
      enExp: 3,
    })
    // 2026-08-14 sanctioned decrement (25 -> 24): '지출 내역 보여줘'
    // MIGRATED to QUERY_HISTORY — it asks for the LIST, and the group
    // total was only ever a compromise answer from before a list intent
    // existed. The row lives on in classify.test.ts's QUERY_HISTORY suite.
    expect(counts(byIntent('QUERY_GROUP_TOTAL'))).toEqual({
      koMain: 24,
      koExp: 5,
      enMain: 14,
      enExp: 0,
    })
    expect(counts(byIntent('QUERY_MY_SPENDING'))).toEqual({
      koMain: 20,
      koExp: 5,
      enMain: 10,
      enExp: 0,
    })
    expect(counts(byIntent('QUERY_WALLET'))).toEqual({
      koMain: 18,
      koExp: 4,
      enMain: 5,
      enExp: 0,
    })
    // 209 -> 208: the QUERY_HISTORY migration above (same sanction).
    expect(QUERY_CORPUS.length).toBe(208)

    // CONFIRM_TOKENS/NEGATE_TOKENS were untouched by the reshape — still
    // spec-exact (tables 3.2/3.3), EXCEPT the Task 11 sanctioned increment
    // below.
    // TASK 11 SANCTIONED INCREMENT (fix round 1, controller ruling): en main
    // 22 -> 26 — `yes`, `yes please`, `confirm`, `save it`. Every clipped
    // form of `yes` (y/yep/yup/yeah/yea) was already here and the plain word
    // was not, so "yes" with a card open resolved to UNKNOWN. `correct` and
    // `right` were evaluated and REJECTED (both read as a correction as
    // easily as an agreement) — see the lexicon's own comment.
    expect(counts(CONFIRM_TOKENS)).toEqual({
      koMain: 35,
      koExp: 11,
      enMain: 26,
      enExp: 4,
    })
    expect(counts(NEGATE_TOKENS)).toEqual({
      koMain: 28,
      koExp: 5,
      enMain: 14,
      enExp: 0,
    })
  })
})
