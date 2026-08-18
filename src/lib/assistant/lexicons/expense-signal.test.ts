import { describe, expect, it } from 'vitest'
import { hasPayVerb } from '../../chat-parse/people'
import { PAY_VERB_STEMS, VERBALIZING_SUFFIXES } from './expense-signal'

/**
 * Drift-alarm invariant (reviewer's Seam, round 2): `PAY_VERB_STEMS` +
 * `VERBALIZING_SUFFIXES` only make sense as a TIGHTENING layered on top of
 * chat-parse's real `hasPayVerb` — every stem+suffix combination this file
 * claims is a genuine pay-verb hit must actually be recognized by the
 * predicate it's tightening. If `hasPayVerb`'s underlying regex ever drops
 * `계산`/`결제`, this test catches the drift instead of `classify.ts`
 * silently trusting a combination `hasPayVerb` no longer agrees with.
 */
describe('expense-signal drift alarm', () => {
  it('every PAY_VERB_STEMS + VERBALIZING_SUFFIXES combination is recognized by hasPayVerb', () => {
    for (const stem of PAY_VERB_STEMS) {
      for (const suffix of VERBALIZING_SUFFIXES) {
        expect(hasPayVerb(stem.word + suffix)).toBe(true)
      }
    }
  })

  it('a bare stem with no suffix is STILL recognized by hasPayVerb (that looseness is exactly what the suffix-gate exists to narrow)', () => {
    for (const stem of PAY_VERB_STEMS) {
      expect(hasPayVerb(stem.word)).toBe(true)
    }
  })
})
