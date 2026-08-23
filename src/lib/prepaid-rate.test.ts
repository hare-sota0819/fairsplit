import fc from 'fast-check'
import { describe, expect, test } from 'vitest'
import { planFreeze, type FreezableExpenseRow } from './checkpoint-freeze'
import { toEngineExpense } from './engine-map'
import {
  convertExpense,
  rateFromDecimalString,
  resolveSourceRate,
  type ExchangeRecordInput,
  type Rate,
  type SettlementContext,
  type WalletType,
} from './settlement'

/**
 * Prepaid rate attribution, as a property rather than as examples.
 *
 * The rule: money exchanged BEFORE it was spent converts at what that pot of
 * money actually cost, never at the market snapshot. `phase4a.test.ts` already
 * pins it with fixed numbers — a cash wallet at 9.5 and a travel card at 9.13 —
 * but fixed numbers cannot say "for every wallet, every rate, every amount",
 * and it is the general statement the behaviour is supposed to be.
 *
 * The wallet TYPE is the part most at risk of drifting, because "prepaid card"
 * sounds like a card and cards are pay-as-you-go. It is not: `WalletType`
 * exists for labelling, and prepaid-ness is carried by there being a wallet at
 * all. Every property below therefore runs over all three types and asserts
 * they are indistinguishable.
 *
 * The last property is this file's reason for living beside the checkpoint
 * work: a freeze has to persist WHICHEVER source actually applied, so a
 * prepaid expense must come out of a checkpoint still saying its money cost
 * what it cost — not relabelled, and not repriced by a top-up logged later.
 */

const WALLET_TYPES: WalletType[] = ['CASH', 'TRAVEL_CARD', 'OTHER_PREPAID']

/** Exact rational equality: a/b === c/d without dividing. */
const sameRate = (a: Rate, b: Rate): boolean =>
  a.numerator * b.denominator === b.numerator * a.denominator

interface Scenario {
  type: WalletType
  foreign: 'JPY' | 'USD'
  topUps: { paid: bigint; received: bigint }[]
  amount: bigint
  snapshotTenths: number
}

const scenario = fc.record({
  type: fc.constantFrom(...WALLET_TYPES),
  // Two exponents on purpose: JPY has no minor unit and USD has two, so a
  // scaling slip between major and minor units shows up here rather than in
  // production.
  foreign: fc.constantFrom('JPY' as const, 'USD' as const),
  topUps: fc.array(
    fc.record({
      paid: fc.bigInt({ min: 1n, max: 100_000_000n }),
      received: fc.bigInt({ min: 1n, max: 10_000_000n }),
    }),
    { minLength: 1, maxLength: 4 },
  ),
  amount: fc.bigInt({ min: 1n, max: 5_000_000n }),
  snapshotTenths: fc.integer({ min: 1, max: 20_000 }),
})

const contextFor = (s: Scenario): SettlementContext => ({
  settlementCurrency: 'KRW',
  walletsById: new Map([
    [
      'w1',
      {
        id: 'w1',
        memberId: 'alice',
        type: s.type,
        label: 'Pot',
        currency: s.foreign,
      },
    ],
  ]),
  recordsByWallet: new Map([
    [
      'w1',
      s.topUps.map((topUp): ExchangeRecordInput => ({
        walletId: 'w1',
        amountPaid: topUp.paid,
        amountReceived: topUp.received,
        currency: s.foreign,
      })),
    ],
  ]),
})

/** What the wallet's money cost: sum(paid) / sum(received), in minor units. */
const walletCost = (s: Scenario): Rate => ({
  numerator: s.topUps.reduce((total, topUp) => total + topUp.paid, 0n),
  denominator: s.topUps.reduce((total, topUp) => total + topUp.received, 0n),
})

const snapshotOf = (s: Scenario): string => (s.snapshotTenths / 10).toFixed(1)

const marketRate = (s: Scenario): Rate =>
  rateFromDecimalString(snapshotOf(s), 'KRW', s.foreign)

const portionOf = (s: Scenario) => ({ amount: s.amount, walletId: 'w1' })

const expenseOf = (s: Scenario) => ({
  currency: s.foreign,
  marketRateSnapshot: snapshotOf(s),
})

describe('property: a prepaid wallet prices at what its money cost', () => {
  test('every wallet type, at the wallet average and never the snapshot', () => {
    fc.assert(
      fc.property(scenario, (s) => {
        const resolved = resolveSourceRate(
          portionOf(s),
          expenseOf(s),
          'AVG_COST',
          contextFor(s),
        )
        expect(resolved.source).toBe('WALLET_AVG_COST')
        expect(sameRate(resolved.rate, walletCost(s))).toBe(true)
        // And it is genuinely NOT the market snapshot. Stated separately from
        // the line above because "equals the average" and "is not the market
        // rate" are the same fact only while the two differ — which is exactly
        // when the bug this guards against would be visible.
        if (!sameRate(walletCost(s), marketRate(s))) {
          expect(sameRate(resolved.rate, marketRate(s))).toBe(false)
        }
      }),
    )
  })

  test('a bank figure cannot reprice money that was already bought', () => {
    fc.assert(
      fc.property(scenario, (s) => {
        // `actualChargedAmount` is what a bank billed for a pay-as-you-go
        // purchase. A prepaid pot was paid for before the purchase happened,
        // so there is no bank line to prefer — and the wallet's cost stands.
        const resolved = resolveSourceRate(
          { ...portionOf(s), actualChargedAmount: s.amount * 3n + 1n },
          expenseOf(s),
          'AVG_COST',
          contextFor(s),
        )
        expect(resolved.source).toBe('WALLET_AVG_COST')
        expect(sameRate(resolved.rate, walletCost(s))).toBe(true)
      }),
    )
  })

  test('MARKET mode still ignores the wallet, and that asymmetry is on purpose', () => {
    fc.assert(
      fc.property(scenario, (s) => {
        // Recorded so a later "make prepaid consistent everywhere" change has
        // to argue with a test: MARKET mode settles the group at one shared
        // rate, and one member's private cost has no business in it.
        const resolved = resolveSourceRate(
          portionOf(s),
          expenseOf(s),
          'MARKET',
          contextFor(s),
        )
        expect(resolved.source).toBe('MARKET_SNAPSHOT')
        expect(sameRate(resolved.rate, marketRate(s))).toBe(true)
      }),
    )
  })
})

/**
 * The interaction the checkpoint spec names outright: "frozen expenses must
 * persist whichever rate source was actually applied".
 */
describe('property: a checkpoint preserves the prepaid attribution', () => {
  const rowFor = (s: Scenario): FreezableExpenseRow => ({
    id: 'e1',
    timestamp: new Date('2026-08-01T12:00:00Z'),
    frozenAtCheckpointId: null,
    payerId: 'alice',
    amount: s.amount,
    currency: s.foreign,
    marketRateSnapshot: { toString: () => snapshotOf(s) },
    funding: [
      {
        id: 'f1',
        amount: s.amount,
        walletId: 'w1',
        actualChargedAmount: null,
        ownRateSnapshot: null,
        funderId: null,
        frozenRateNum: null,
        frozenRateDen: null,
        frozenSource: null,
        frozenAmount: null,
      },
    ],
    participants: [{ memberId: 'alice' }, { memberId: 'bob' }],
    items: [],
  })

  test('the stored source is the real one, and a later top-up cannot move it', () => {
    fc.assert(
      fc.property(
        scenario,
        fc.bigInt({ min: 1n, max: 9_000_000n }),
        (s, extra) => {
          const context = contextFor(s)
          const [plan] = planFreeze(
            [rowFor(s)],
            new Date('2026-08-05T00:00:00Z'),
            'AVG_COST',
            context,
          )
          const portion = plan.portions[0]
          // WALLET_AVG_COST, not FROZEN: the chip says frozen, the record says
          // what priced the money. Losing this is losing the audit.
          expect(portion.source).toBe('WALLET_AVG_COST')
          expect(
            sameRate(
              { numerator: portion.rateNum, denominator: portion.rateDen },
              walletCost(s),
            ),
          ).toBe(true)

          const frozenRow: FreezableExpenseRow = {
            ...rowFor(s),
            frozenAtCheckpointId: 'cp-1',
            funding: [
              {
                ...rowFor(s).funding[0],
                frozenRateNum: portion.rateNum,
                frozenRateDen: portion.rateDen,
                frozenSource: portion.source,
                frozenAmount: portion.amount,
              },
            ],
          }

          // Somebody logs a forgotten exchange into the same pot at a wildly
          // different price. The settled expense keeps both its figure and its
          // attribution.
          const afterwards: SettlementContext = {
            ...context,
            recordsByWallet: new Map([
              [
                'w1',
                [
                  ...(context.recordsByWallet.get('w1') ?? []),
                  {
                    walletId: 'w1',
                    amountPaid: extra,
                    amountReceived: 1n,
                    currency: s.foreign,
                  },
                ],
              ],
            ]),
          }
          const converted = convertExpense(
            toEngineExpense(frozenRow),
            'AVG_COST',
            afterwards,
          )
          expect(converted.amount).toBe(plan.settlementAmount)
          expect(converted.source).toBe('WALLET_AVG_COST')
          expect(converted.frozen).toBe(true)
        },
      ),
    )
  })
})
