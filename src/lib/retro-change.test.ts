import fc from 'fast-check'
import { describe, expect, test } from 'vitest'
import {
  RETRO_CHANGE_EXPIRY_HOURS,
  RETRO_CHANGE_REMINDER_HOURS,
  balanceDiff,
  consentSet,
  expiryOf,
  isAutoApproved,
  outcomeOf,
  pendingProgress,
  reminderDueAt,
} from './retro-change'

const map = (entries: Record<string, bigint>) =>
  new Map(Object.entries(entries))

describe('balanceDiff', () => {
  test('negative means worse off, and every named member gets an entry', () => {
    const diff = balanceDiff(
      map({ alice: 1_000n, bob: -1_000n }),
      map({ alice: 800n, bob: -1_000n, carol: 200n }),
    )
    expect(diff.get('alice')).toBe(-200n)
    expect(diff.get('bob')).toBe(0n)
    expect(diff.get('carol')).toBe(200n)
  })
})

describe('the consent set', () => {
  test('is exactly the members worse off by a minor unit or more', () => {
    expect(
      consentSet(map({ alice: -1n, bob: 0n, carol: 5n, dave: -900n })),
    ).toEqual(['alice', 'dave'])
  })

  test('a one-unit worsening is asked about, not swallowed as rounding', () => {
    // The spec is explicit: surplus redistribution moving 1-2 minor units is
    // still someone's money, and follows the same rule as anything else.
    expect(consentSet(map({ alice: -1n }))).toEqual(['alice'])
    expect(isAutoApproved(map({ alice: -1n }))).toBe(false)
  })

  test('nobody is asked about a change that only benefits people', () => {
    expect(consentSet(map({ alice: 0n, bob: 12_000n }))).toEqual([])
    expect(isAutoApproved(map({ alice: 0n, bob: 12_000n }))).toBe(true)
  })

  test('nobody consents to their own proposal', () => {
    // The spec's own example of the auto-approval case: a requester reducing
    // their over-entered expense ends up owed LESS, and everyone else gains.
    // Counting the requester would make that case need their own agreement,
    // and nothing would ever apply straight away.
    const diff = map({ alice: -30_000n, bob: 30_000n })
    expect(consentSet(diff)).toEqual(['alice'])
    expect(consentSet(diff, 'alice')).toEqual([])
    expect(isAutoApproved(diff, 'alice')).toBe(true)
  })

  test('but the requester cannot sign away anyone else', () => {
    const diff = map({ alice: -30_000n, bob: -1n, carol: 30_001n })
    expect(consentSet(diff, 'alice')).toEqual(['bob'])
    expect(isAutoApproved(diff, 'alice')).toBe(false)
  })
})

/**
 * The spec's property #3. Auto-approval and the consent set are one decision
 * seen from two sides, and this is what says so for every diff there is.
 */
describe('property: auto-approval fires iff nobody worsens', () => {
  const diffArb = fc
    .array(fc.bigInt({ min: -1_000_000n, max: 1_000_000n }), {
      minLength: 1,
      maxLength: 8,
    })
    .map((deltas) => new Map(deltas.map((delta, i) => [`m${i}`, delta])))

  test('and the consent set is exactly the worsened members', () => {
    fc.assert(
      fc.property(diffArb, fc.integer({ min: 0, max: 7 }), (diff, asker) => {
        const requesterId = `m${asker}`
        const worsened = [...diff.entries()]
          .filter(([id, delta]) => id !== requesterId && delta <= -1n)
          .map(([id]) => id)
          .sort()
        expect(consentSet(diff, requesterId)).toEqual(worsened)
        expect(isAutoApproved(diff, requesterId)).toBe(worsened.length === 0)
      }),
    )
  })
})

describe('the deadline', () => {
  const opened = new Date('2026-08-22T00:00:00Z')
  const hours = (n: number) => new Date(opened.getTime() + n * 3_600_000)

  test('is 24 hours to a reminder and 72 to the end', () => {
    expect(RETRO_CHANGE_REMINDER_HOURS).toBe(24)
    expect(RETRO_CHANGE_EXPIRY_HOURS).toBe(72)
    expect(reminderDueAt(opened)).toEqual(hours(24))
    expect(expiryOf(opened)).toEqual(hours(72))
  })

  test('nudges once at 24 hours, and not again once it has been sent', () => {
    expect(pendingProgress(opened, hours(23), null)).toBe('OPEN')
    expect(pendingProgress(opened, hours(24), null)).toBe('REMIND')
    expect(pendingProgress(opened, hours(30), hours(24))).toBe('OPEN')
  })

  test('expires at 72 hours — and expiry is REJECTION, never approval', () => {
    // Reminder already sent, so the only question left is the deadline.
    expect(pendingProgress(opened, hours(71.9), hours(24))).toBe('OPEN')
    expect(pendingProgress(opened, hours(72), null)).toBe('EXPIRED')
    expect(pendingProgress(opened, hours(1_000), hours(24))).toBe('EXPIRED')
    // Said plainly, because it is the rule most likely to be "simplified"
    // later: an expired request resolves to REJECTED in `settleExpiredRequests`
    // and is audited as EXPIRED. There is no code path anywhere that turns a
    // deadline into an approval.
  })
})

describe('outcomeOf', () => {
  test('one refusal ends it, whatever anyone else said', () => {
    expect(outcomeOf(['APPROVED', 'REJECTED', null])).toBe('REJECTED')
  })

  test('it carries only when every stakeholder has said yes', () => {
    expect(outcomeOf(['APPROVED', 'APPROVED'])).toBe('APPROVED')
    expect(outcomeOf(['APPROVED', null])).toBe('PENDING')
  })

  test('no stakeholders at all is the auto-approval case', () => {
    expect(outcomeOf([])).toBe('APPROVED')
  })
})
