import { describe, expect, it } from 'vitest'
import {
  DRAFT_TTL_MS,
  DRAFT_VERSION,
  draftKey,
  parseDraft,
  serializeDraft,
  type ExpenseDraft,
} from './expense-draft'

const sample: Omit<ExpenseDraft, 'savedAt' | 'v'> = {
  step: 2,
  maxStep: 3,
  amount: '1200',
  currency: 'JPY',
  payerId: 'm1',
  funding: { kind: 'WALLET', walletId: 'w1' },
  extraFunding: [],
  topUpAmount: '',
  topUpRate: '',
  topUpPaid: '',
  note: 'ramen',
  timestamp: '2026-08-02T19:30',
  participantIds: ['m1', 'm2'],
  items: [
    {
      key: 0,
      name: 'Ramen',
      unitAmount: '1200',
      quantity: 2,
      splitMode: 'BY_QUANTITY',
      assignees: [{ memberId: 'm2', quantity: 2 }],
    },
  ],
  nextKey: 1,
  isPersonal: true,
  ownRate: '913',
  manualOpen: true,
  manualRate: '9.4',
  receiptTotal: '2400',
  receiptTouched: true,
}

describe('draftKey', () => {
  it('separates the new-expense draft from a per-expense edit draft', () => {
    expect(draftKey('g1')).toBe('fairsplit:expense-draft:g1:new')
    expect(draftKey('g1', 'e1')).toBe('fairsplit:expense-draft:g1:e1')
  })
})

describe('serializeDraft / parseDraft', () => {
  it('round-trips every field, including the wizard step and per-person qty', () => {
    const raw = serializeDraft(sample, 1_000)
    expect(parseDraft(raw, 1_000)).toEqual({
      ...sample,
      v: DRAFT_VERSION,
      savedAt: 1_000,
    })
  })

  it('keeps a draft parked just under the TTL', () => {
    const raw = serializeDraft(sample, 0)
    expect(parseDraft(raw, DRAFT_TTL_MS - 1)?.amount).toBe('1200')
  })

  it('drops a draft once the TTL has elapsed', () => {
    const raw = serializeDraft(sample, 0)
    expect(parseDraft(raw, DRAFT_TTL_MS)).toBeNull()
  })

  it('discards a draft written by an older shape rather than half-reading it', () => {
    // A Phase 3C draft: same key, same savedAt stamp, incompatible fields.
    const legacy = JSON.stringify({
      amount: '1200',
      currency: 'JPY',
      payerId: 'm1',
      method: 'CARD',
      items: [{ key: 0, name: 'Ramen', amount: '1200', assigneeIds: ['m2'] }],
      participantIds: ['m1'],
      savedAt: 500,
    })
    expect(parseDraft(legacy, 600)).toBeNull()
  })

  it('returns null for absent, malformed or unstamped storage', () => {
    expect(parseDraft(null, 0)).toBeNull()
    expect(parseDraft('{not json', 0)).toBeNull()
    expect(parseDraft('"a string"', 0)).toBeNull()
    expect(parseDraft(JSON.stringify({ amount: '1' }), 0)).toBeNull()
  })
})
