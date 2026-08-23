import fc from 'fast-check'
import { describe, expect, test } from 'vitest'
import { planFreeze, type FreezableExpenseRow } from './checkpoint-freeze'
import { toEngineExpense } from './engine-map'
import { balanceDiff } from './retro-change'
import {
  decodeDiff,
  encodeDiff,
  encodeProposal,
  proposalToEngineExpense,
} from './retro-proposal'
import {
  computeNetBalances,
  convertFunding,
  type ExchangeRecordInput,
  type SettlementContext,
} from './settlement'

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

const topUp: ExchangeRecordInput = {
  walletId: 'alice-jpy',
  amountPaid: 931_000n,
  amountReceived: 100_000n,
  currency: 'JPY',
}

const context: SettlementContext = {
  settlementCurrency: 'KRW',
  walletsById,
  recordsByWallet: new Map([['alice-jpy', [topUp]]]),
}

const sum = (balances: Map<string, bigint>): bigint =>
  [...balances.values()].reduce((a, b) => a + b, 0n)

const row = (
  id: string,
  amount: bigint,
  prepaid: boolean,
): FreezableExpenseRow => ({
  id,
  timestamp: new Date('2026-08-01T12:00:00Z'),
  frozenAtCheckpointId: null,
  payerId: 'alice',
  amount,
  currency: 'JPY',
  marketRateSnapshot: { toString: () => '9.5' },
  funding: [
    {
      id: `f-${id}`,
      amount,
      walletId: prepaid ? 'alice-jpy' : null,
      actualChargedAmount: null,
      ownRateSnapshot: null,
      funderId: null,
      frozenRateNum: null,
      frozenRateDen: null,
      frozenSource: null,
      frozenAmount: null,
    },
  ],
  participants: [
    { memberId: 'alice' },
    { memberId: 'bob' },
    { memberId: 'carol' },
  ],
  items: [],
})

/** Freeze a row the way `createCheckpoint` does, in memory. */
const freeze = (source: FreezableExpenseRow): FreezableExpenseRow => {
  const [plan] = planFreeze(
    [source],
    new Date('2026-08-05T00:00:00Z'),
    'AVG_COST',
    context,
  )
  const portion = plan.portions[0]
  return {
    ...source,
    frozenAtCheckpointId: 'cp-1',
    funding: [
      {
        ...source.funding[0],
        frozenRateNum: portion.rateNum,
        frozenRateDen: portion.rateDen,
        frozenSource: portion.source,
        frozenAmount: portion.amount,
      },
    ],
  }
}

describe('the diff codec', () => {
  test('money crosses JSON as strings, and comes back exact', () => {
    // Well past 2^53: a `Number` round trip would silently lose this, and in a
    // column holding won it is an ordinary trip's worth of money.
    const diff = new Map([
      ['alice', 9_007_199_254_740_993n],
      ['bob', -9_007_199_254_740_993n],
    ])
    const stored = encodeDiff(diff)
    expect(typeof stored.alice).toBe('string')
    expect(decodeDiff(stored)).toEqual(diff)
  })
})

/**
 * The spec's property #2: a frozen balance is zero-sum before a change is
 * proposed, while it is pending, and after it has been applied.
 *
 * The middle one is the claim that matters, and it is structural rather than
 * arithmetic: a pending proposal is stored, never applied, so the balances on
 * the settlement screen are still exactly the frozen ones. Nothing is ever
 * half-mixed in, which is what the spec means by "pending values must NEVER be
 * mixed into the main settlement numbers".
 */
describe('property: zero-sum survives a retroactive change', () => {
  const scenario = fc.record({
    amounts: fc.array(fc.bigInt({ min: 100n, max: 900_000n }), {
      minLength: 1,
      maxLength: 5,
    }),
    prepaid: fc.array(fc.boolean(), { minLength: 5, maxLength: 5 }),
    revised: fc.bigInt({ min: 100n, max: 900_000n }),
  })

  test('before, during a pending request, and after approval', () => {
    fc.assert(
      fc.property(scenario, ({ amounts, prepaid, revised }) => {
        const frozen = amounts.map((amount, index) =>
          freeze(row(`e${index}`, amount, prepaid[index] ?? false)),
        )

        // BEFORE: the settled period.
        const before = computeNetBalances(
          frozen.map(toEngineExpense),
          'AVG_COST',
          context,
        )
        expect(sum(before)).toBe(0n)

        // A proposal to revise the first expense, priced now and kept.
        const target = frozen[0]
        const priced = convertFunding(
          {
            payerId: 'alice',
            amount: revised,
            currency: 'JPY',
            marketRateSnapshot: '9.5',
            funding: [
              { amount: revised, walletId: target.funding[0].walletId },
            ],
          },
          'AVG_COST',
          context,
        )
        const proposal = encodeProposal({
          title: 'revised',
          payerId: 'alice',
          note: null,
          isPersonal: false,
          receiptImagePath: null,
          amount: revised,
          timestamp: target.timestamp,
          participantIds: ['alice', 'bob', 'carol'],
          items: [],
          funding: [
            {
              position: 0,
              amount: revised,
              walletId: target.funding[0].walletId,
              ownRateSnapshot: null,
              funderId: null,
            },
          ],
          priced: priced.portions.map((portion) => ({
            rateNum: portion.resolution.rate.numerator,
            rateDen: portion.resolution.rate.denominator,
            source: portion.resolution.source,
            settlement: portion.settlement,
          })),
          frozenAtCheckpointId: 'cp-1',
        })

        // DURING: the request exists, and the balances have not budged.
        const during = computeNetBalances(
          frozen.map(toEngineExpense),
          'AVG_COST',
          context,
        )
        expect(during).toEqual(before)
        expect(sum(during)).toBe(0n)

        // AFTER: approved, so the proposal replaces the expense.
        const after = computeNetBalances(
          [
            proposalToEngineExpense(proposal, {
              currency: 'JPY',
              marketRateSnapshot: '9.5',
            }),
            ...frozen.slice(1).map(toEngineExpense),
          ],
          'AVG_COST',
          context,
        )
        expect(sum(after)).toBe(0n)

        // And the diff itself nets out: what one member gains, the others
        // lose, exactly. A diff that did not sum to zero would mean the
        // approvers had been shown a change that invents or destroys money.
        expect(sum(balanceDiff(before, after))).toBe(0n)
      }),
    )
  })
})
