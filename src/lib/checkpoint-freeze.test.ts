import fc from 'fast-check'
import { describe, expect, test } from 'vitest'
import {
  isBeforeCheckpoint,
  planFreeze,
  type FreezableExpenseRow,
} from './checkpoint-freeze'
import { toEngineExpense, type FundingRow } from './engine-map'
import {
  computeNetBalances,
  convertExpense,
  displayRateSource,
  type ExchangeRecordInput,
  type SettlementContext,
} from './settlement'

/**
 * A two-member JPY trip settling in KRW. Alice pays from a cash wallet whose
 * average cost moves the moment a top-up is logged — which is precisely the
 * thing a checkpoint has to stop.
 */
const walletsById: SettlementContext['walletsById'] = new Map([
  [
    'alice-jpy',
    {
      id: 'alice-jpy',
      memberId: 'alice',
      type: 'CASH' as const,
      label: 'Cash',
      currency: 'JPY',
    },
  ],
])

const firstTopUp: ExchangeRecordInput = {
  walletId: 'alice-jpy',
  amountPaid: 931_000n,
  amountReceived: 100_000n,
  currency: 'JPY',
}

const contextWith = (records: ExchangeRecordInput[]): SettlementContext => ({
  settlementCurrency: 'KRW',
  walletsById,
  recordsByWallet: new Map([['alice-jpy', records]]),
})

const funding = (over: Partial<FundingRow> & { id: string }) => ({
  amount: 11_000n,
  walletId: 'alice-jpy' as string | null,
  actualChargedAmount: null,
  ownRateSnapshot: null,
  funderId: null,
  frozenRateNum: null as bigint | null,
  frozenRateDen: null as bigint | null,
  frozenSource: null as string | null,
  frozenAmount: null as bigint | null,
  ...over,
})

const expenseRow = (
  over: Partial<FreezableExpenseRow> = {},
): FreezableExpenseRow => ({
  id: 'e1',
  timestamp: new Date('2026-08-01T12:00:00Z'),
  frozenAtCheckpointId: null,
  payerId: 'alice',
  amount: 11_000n,
  currency: 'JPY',
  marketRateSnapshot: { toString: () => '9.5' },
  funding: [funding({ id: 'f1' })],
  participants: [{ memberId: 'alice' }, { memberId: 'bob' }],
  items: [],
  ...over,
})

/** Write a plan back onto the rows, the way `applyFreeze` does in the DB. */
const applyPlan = (
  rows: FreezableExpenseRow[],
  checkpointId: string,
  plans: ReturnType<typeof planFreeze>,
): FreezableExpenseRow[] => {
  const byExpense = new Map(plans.map((plan) => [plan.expenseId, plan]))
  return rows.map((row) => {
    const plan = byExpense.get(row.id)
    if (plan === undefined) return row
    const byFunding = new Map(
      plan.portions.map((portion) => [portion.fundingId, portion]),
    )
    return {
      ...row,
      frozenAtCheckpointId: checkpointId,
      funding: row.funding.map((source) => {
        const portion = byFunding.get(source.id)
        return portion === undefined
          ? source
          : {
              ...source,
              frozenRateNum: portion.rateNum,
              frozenRateDen: portion.rateDen,
              frozenSource: portion.source,
              frozenAmount: portion.amount,
            }
      }),
    }
  })
}

describe('isBeforeCheckpoint', () => {
  const boundary = new Date('2026-08-05T00:00:00Z')

  test('the boundary instant belongs to the checkpoint it closes', () => {
    expect(isBeforeCheckpoint(new Date(boundary), boundary)).toBe(true)
  })

  test('anything after it does not', () => {
    expect(
      isBeforeCheckpoint(new Date('2026-08-05T00:00:00.001Z'), boundary),
    ).toBe(false)
  })
})

describe('planFreeze', () => {
  const boundary = new Date('2026-08-05T00:00:00Z')

  test('pins the rate that actually applied, never FROZEN', () => {
    const rows = [expenseRow()]
    const [plan] = planFreeze(
      rows,
      boundary,
      'AVG_COST',
      contextWith([firstTopUp]),
    )
    expect(plan.portions).toEqual([
      {
        fundingId: 'f1',
        rateNum: 931_000n,
        rateDen: 100_000n,
        source: 'WALLET_AVG_COST',
        amount: 102_410n,
      },
    ])
    expect(plan.settlementAmount).toBe(102_410n)
  })

  test('the frozen total is what converting the live expense produced', () => {
    const context = contextWith([firstTopUp])
    const rows = [expenseRow()]
    const [plan] = planFreeze(rows, boundary, 'AVG_COST', context)
    expect(plan.settlementAmount).toBe(
      convertExpense(toEngineExpense(rows[0]), 'AVG_COST', context).amount,
    )
  })

  test('skips expenses after the boundary and ones already frozen', () => {
    const rows = [
      expenseRow({ id: 'after', timestamp: new Date('2026-08-09T00:00:00Z') }),
      expenseRow({ id: 'done', frozenAtCheckpointId: 'cp-earlier' }),
      expenseRow({ id: 'fresh' }),
    ]
    expect(
      planFreeze(rows, boundary, 'AVG_COST', contextWith([firstTopUp])).map(
        (plan) => plan.expenseId,
      ),
    ).toEqual(['fresh'])
  })

  test('cancelled and personal expenses are frozen too', () => {
    // Neither reaches the balance today, but both can come back — a restored
    // expense must not re-enter a settled period at a rate computed since.
    const rows = [
      expenseRow({ id: 'cancelled' }),
      expenseRow({ id: 'personal' }),
    ]
    expect(
      planFreeze(rows, boundary, 'AVG_COST', contextWith([firstTopUp])).length,
    ).toBe(2)
  })

  test('a split-funded expense pins each portion at its own rate', () => {
    const rows = [
      expenseRow({
        amount: 20_000n,
        funding: [
          funding({ id: 'f1', amount: 12_000n, walletId: 'alice-jpy' }),
          funding({ id: 'f2', amount: 8_000n, walletId: null }),
        ],
      }),
    ]
    const [plan] = planFreeze(
      rows,
      boundary,
      'AVG_COST',
      contextWith([firstTopUp]),
    )
    expect(plan.portions.map((portion) => portion.source)).toEqual([
      'WALLET_AVG_COST',
      'MARKET_SNAPSHOT',
    ])
    expect(plan.settlementAmount).toBe(
      plan.portions.reduce((total, portion) => total + portion.amount, 0n),
    )
  })
})

describe('a frozen expense resolves at its pinned rate', () => {
  const boundary = new Date('2026-08-05T00:00:00Z')

  test('the chip says FROZEN while the record keeps the real source', () => {
    const frozen = applyPlan(
      [expenseRow()],
      'cp-1',
      planFreeze(
        [expenseRow()],
        boundary,
        'AVG_COST',
        contextWith([firstTopUp]),
      ),
    )[0]
    const converted = convertExpense(
      toEngineExpense(frozen),
      'AVG_COST',
      contextWith([firstTopUp]),
    )
    expect(converted.frozen).toBe(true)
    expect(converted.source).toBe('WALLET_AVG_COST')
    expect(displayRateSource(converted)).toBe('FROZEN')
  })

  test('a partially written freeze refuses to price rather than drifting', () => {
    const half = expenseRow({
      funding: [funding({ id: 'f1', frozenRateNum: 931_000n })],
    })
    expect(() => toEngineExpense(half)).toThrow(/partially frozen/)
  })
})

/**
 * The spec's property #1, and the reason the whole feature exists: a top-up
 * logged after the fact — backdated or not — must not move one won of a
 * settled period.
 */
describe('property: a later top-up cannot move a frozen period', () => {
  const boundary = new Date('2026-08-05T00:00:00Z')

  const laterTopUp = fc.record({
    amountPaid: fc.bigInt({ min: 1_000n, max: 100_000_000n }),
    amountReceived: fc.bigInt({ min: 1_000n, max: 10_000_000n }),
  })

  const beforeBoundary = fc
    .integer({ min: 0, max: 4 * 24 * 60 })
    .map((minutes) => new Date(boundary.getTime() - minutes * 60_000))

  const rowArb = fc
    .record({
      amount: fc.bigInt({ min: 100n, max: 5_000_000n }),
      timestamp: beforeBoundary,
      prepaid: fc.boolean(),
      snapshotTenths: fc.integer({ min: 1, max: 2_000 }),
    })
    .map((raw): FreezableExpenseRow =>
      expenseRow({
        amount: raw.amount,
        timestamp: raw.timestamp,
        marketRateSnapshot: {
          toString: () => (raw.snapshotTenths / 10).toFixed(1),
        },
        funding: [
          funding({
            id: 'f1',
            amount: raw.amount,
            walletId: raw.prepaid ? 'alice-jpy' : null,
          }),
        ],
      }),
    )

  test('frozen amounts and the frozen balance are unchanged', () => {
    fc.assert(
      fc.property(
        fc.array(rowArb, { minLength: 1, maxLength: 8 }),
        fc.array(laterTopUp, { minLength: 1, maxLength: 4 }),
        (rawRows, topUps) => {
          // Ids have to be distinct for the plan to map back onto the rows.
          const rows = rawRows.map((row, index) => ({
            ...row,
            id: `e${index}`,
            funding: row.funding.map((source) => ({
              ...source,
              id: `f${index}`,
            })),
          }))
          const atFreeze = contextWith([firstTopUp])
          const plans = planFreeze(rows, boundary, 'AVG_COST', atFreeze)
          const frozenRows = applyPlan(rows, 'cp-1', plans)

          // The balance the group settled on, and every per-expense total.
          const settledBalances = computeNetBalances(
            frozenRows.map(toEngineExpense),
            'AVG_COST',
            atFreeze,
          )

          // Someone now logs forgotten pre-trip exchanges. The wallet's
          // average cost moves; the settled period must not.
          const afterwards = contextWith([
            firstTopUp,
            ...topUps.map((topUp) => ({
              walletId: 'alice-jpy',
              amountPaid: topUp.amountPaid,
              amountReceived: topUp.amountReceived,
              currency: 'JPY',
            })),
          ])

          for (const [index, row] of frozenRows.entries()) {
            const converted = convertExpense(
              toEngineExpense(row),
              'AVG_COST',
              afterwards,
            )
            expect(converted.amount).toBe(plans[index].settlementAmount)
            expect(converted.frozen).toBe(true)
          }

          const laterBalances = computeNetBalances(
            frozenRows.map(toEngineExpense),
            'AVG_COST',
            afterwards,
          )
          for (const [memberId, balance] of settledBalances) {
            expect(laterBalances.get(memberId)).toBe(balance)
          }
          // Zero-sum survives freezing, which a stored balance total would
          // have had to be trusted to preserve.
          expect([...laterBalances.values()].reduce((a, b) => a + b, 0n)).toBe(
            0n,
          )
        },
      ),
    )
  })
})
