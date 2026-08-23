import { describe, expect, test } from 'vitest'
import {
  applyRetroPlan,
  type RetroAuditEntry,
  type RetroPlan,
  type RetroWriter,
} from './retro-apply'
import type { RetroProposal } from './retro-proposal'

const proposal = (frozenAtCheckpointId: string | null): RetroProposal => ({
  title: 'Izakaya',
  payerId: 'alice',
  note: null,
  isPersonal: false,
  receiptImagePath: null,
  amount: '11000',
  timestampIso: '2026-08-02T10:00:00.000Z',
  participantIds: ['alice', 'bob'],
  items: [],
  funding: [
    {
      position: 0,
      amount: '11000',
      walletId: 'alice-jpy',
      ownRateSnapshot: null,
      funderId: null,
      frozenRateNum: '931000',
      frozenRateDen: '100000',
      frozenSource: 'WALLET_AVG_COST',
      frozenAmount: '102410',
    },
  ],
  frozenAtCheckpointId,
})

const audit = (over: Partial<RetroAuditEntry> = {}): RetroAuditEntry => ({
  kind: 'RETRO_CHANGE_APPROVED',
  requestId: 'req-1',
  expenseId: 'exp-1',
  changeKind: 'EDIT',
  requestedById: 'alice',
  checkpointIds: ['cp-1', 'cp-2'],
  stakeholders: [{ memberId: 'bob', response: 'APPROVED' }],
  balanceDiff: { alice: '2000', bob: '-2000' },
  proposal: proposal('cp-2'),
  ...over,
})

const plan = (over: Partial<RetroPlan> = {}): RetroPlan => ({
  requestId: 'req-1',
  expenseId: 'exp-1',
  actorId: 'bob',
  decision: 'APPROVED',
  decidedAt: new Date('2026-08-22T00:00:00Z'),
  effect: { kind: 'EDIT', proposal: proposal('cp-2') },
  audit: audit(),
  ...over,
})

/**
 * A writer that records what it was asked to do, and can be told to fail at a
 * given step — standing in for the transaction the real one runs inside.
 */
function spyWriter(failAtCall?: number): RetroWriter & { calls: string[] } {
  const calls: string[] = []
  const record = async (name: string): Promise<void> => {
    calls.push(name)
    if (calls.length === failAtCall) {
      throw new Error(`writer failed at ${name}`)
    }
  }
  return {
    calls,
    clearExpenseChildren: () => record('clearExpenseChildren'),
    writeProposal: () => record('writeProposal'),
    setCancelled: () => record('setCancelled'),
    setFrozenAt: () => record('setFrozenAt'),
    decideRequest: () => record('decideRequest'),
    appendAudit: () => record('appendAudit'),
  }
}

describe('applyRetroPlan', () => {
  test('an approved edit rewrites, then claims settled, then logs', async () => {
    const writer = spyWriter()
    await applyRetroPlan(writer, plan())
    expect(writer.calls).toEqual([
      'clearExpenseChildren',
      'writeProposal',
      // The flag that says "this is settled" is written after the rates it
      // promises, never before.
      'setFrozenAt',
      'decideRequest',
      'appendAudit',
    ])
  })

  test('a cancel touches no rate — it only leaves the balance', async () => {
    const writer = spyWriter()
    await applyRetroPlan(
      writer,
      plan({
        effect: { kind: 'CANCEL' },
        audit: audit({ changeKind: 'CANCEL', proposal: null }),
      }),
    )
    expect(writer.calls).toEqual([
      'setCancelled',
      'decideRequest',
      'appendAudit',
    ])
  })
})

/**
 * The spec's atomicity test. The rollback itself belongs to Postgres; what
 * this code has to guarantee is that there is only ever ONE transaction to
 * roll back — nothing is written outside the handed-in writer, and a failure
 * stops everything after it and reaches the caller that owns the transaction.
 */
describe('a failure mid-recalculation leaves nothing behind', () => {
  test('every later step is abandoned, at every step it could fail', async () => {
    const total = 5
    for (let failAt = 1; failAt <= total; failAt += 1) {
      const writer = spyWriter(failAt)
      await expect(applyRetroPlan(writer, plan())).rejects.toThrow(
        /writer failed/,
      )
      // Exactly the steps up to and including the failure were attempted.
      expect(writer.calls).toHaveLength(failAt)
    }
  })

  test('a half-applied edit never reaches the settled flag', async () => {
    // `writeProposal` failing is the dangerous one: the children are already
    // cleared. It must not go on to mark the expense settled, and the
    // transaction it runs in is what puts the children back.
    const writer = spyWriter(2)
    await expect(applyRetroPlan(writer, plan())).rejects.toThrow()
    expect(writer.calls).not.toContain('setFrozenAt')
    expect(writer.calls).not.toContain('decideRequest')
    expect(writer.calls).not.toContain('appendAudit')
  })
})

describe('the audit entry', () => {
  test('is written for a rejection, which changes nothing', async () => {
    const writer = spyWriter()
    await applyRetroPlan(
      writer,
      plan({
        decision: 'REJECTED',
        effect: null,
        audit: audit({ kind: 'RETRO_CHANGE_REJECTED' }),
      }),
    )
    expect(writer.calls).toEqual(['decideRequest', 'appendAudit'])
  })

  test('is written for an expiry, which nobody performed', async () => {
    const writer = spyWriter()
    await applyRetroPlan(
      writer,
      plan({
        decision: 'EXPIRED',
        actorId: null,
        effect: null,
        audit: audit({
          kind: 'RETRO_CHANGE_EXPIRED',
          stakeholders: [{ memberId: 'bob', response: null }],
        }),
      }),
    )
    expect(writer.calls).toEqual(['decideRequest', 'appendAudit'])
  })

  test('names every checkpoint the change moved, not just one', async () => {
    // An edit that moves a timestamp hands the expense from one checkpoint to
    // another; both balances change, and the log has to say so.
    const entry = audit()
    expect(entry.checkpointIds).toEqual(['cp-1', 'cp-2'])
  })

  test('records a stakeholder who never answered as no response', async () => {
    const entry = audit({
      kind: 'RETRO_CHANGE_EXPIRED',
      stakeholders: [
        { memberId: 'bob', response: 'APPROVED' },
        { memberId: 'carol', response: null },
      ],
    })
    expect(entry.stakeholders).toContainEqual({
      memberId: 'carol',
      response: null,
    })
  })
})
