import { describe, expect, it } from 'vitest'
import type { FormWallet } from '../form-props'
import {
  computeMath,
  pendingTopUp,
  type MarketQuote,
  type WizardState,
} from './math'

/**
 * Which rate the wizard PREVIEWS with, and when.
 *
 * The reported defect: step 1 quoted "913" — one specific wallet's average
 * cost — before the user had said anything about how they paid, and possibly
 * for a wallet they did not own. `state.funding` is pre-seeded from whatever
 * that payer used last, so the form was answering its own question.
 */

const SETTLEMENT = 'KRW'

const WALLET: FormWallet = {
  id: 'w1',
  memberId: 'm1',
  type: 'TRAVEL_CARD',
  label: 'Travel Card',
  currency: 'JPY',
  // 100 JPY cost 913 KRW -> 9.13 in storage units.
  avgRate: '9.13',
  balance: '¥10,000',
  balanceMinor: '10000',
  // ₩456,500 bought ¥50,000 — the 9.13 above, kept as the two figures a
  // top-up made at the till has to be blended into.
  topUpPaidMinor: '456500',
  topUpReceivedMinor: '50000',
  overdrawn: false,
}

// The live market rate at the time of writing: 100 JPY = 914.05 KRW.
const MARKET: MarketQuote = {
  rate: '9.1405',
  asOf: '2026-08-03',
  asOfInstant: '2026-08-03T03:03:00.000Z',
  today: '2026-08-03',
}

const state = (over: Partial<WizardState> = {}): WizardState => ({
  step: 0,
  maxStep: 0,
  amount: '10000',
  currency: 'JPY',
  receiptImagePath: null,
  payerId: 'm1',
  funding: { kind: 'WALLET', walletId: 'w1' },
  extraFunding: [],
  topUpAmount: '',
  topUpRate: '',
  topUpPaid: '',
  note: '',
  timestamp: '2026-08-03T12:00',
  participantIds: ['m1', 'm2'],
  items: [],
  nextKey: 0,
  isPersonal: false,
  ownRate: '',
  manualOpen: false,
  manualRate: '',
  receiptTotal: '10000',
  receiptTouched: false,
  ...over,
})

const run = (s: WizardState, previewAtMarket: boolean) =>
  computeMath(
    s,
    {
      wallets: [WALLET],
      settlementCurrency: SETTLEMENT,
      rateMode: 'AVG_COST',
      previewAtMarket,
    },
    MARKET,
  )

describe('step 1 previews at the market rate', () => {
  it('ignores the pre-seeded wallet before the payment question is answered', () => {
    const math = run(state({ step: 0 }), true)
    expect(math.rateSource).toBe('MARKET_SNAPSHOT')
    expect(math.effectiveRate).toBe('9.1405')
    expect(math.total).toBe(91_405n)
  })

  it('switches to the wallet rate once that wallet IS the answer', () => {
    const math = run(state({ step: 1 }), false)
    expect(math.rateSource).toBe('WALLET_AVG_COST')
    expect(math.effectiveRate).toBe('9.13')
    expect(math.total).toBe(91_300n)
  })

  it('the figure visibly moves between the two, which is the whole point', () => {
    const atMarket = run(state({ step: 0 }), true).total
    const atWallet = run(state({ step: 1 }), false).total
    expect(atMarket).not.toBe(atWallet)
  })

  it('pay-as-you-go previews the same on both steps', () => {
    const s = state({ funding: { kind: 'PAY_AS_YOU_GO' } })
    expect(run(s, true).total).toBe(run(s, false).total)
    expect(run(s, false).rateSource).toBe('MARKET_SNAPSHOT')
  })
})

describe("prepaid with no wallet uses the payer's own rate", () => {
  const prepaidNoWallet = state({
    step: 1,
    funding: { kind: 'PREPAID_NO_WALLET' },
    // Typed in quote units: 100 JPY = 890 KRW.
    ownRate: '890',
  })

  it('converts at the rate the payer typed, labelled as their own', () => {
    const math = computeMath(
      prepaidNoWallet,
      {
        wallets: [],
        settlementCurrency: SETTLEMENT,
        rateMode: 'AVG_COST',
      },
      MARKET,
    )
    expect(math.rateSource).toBe('OWN_EXCHANGE_RATE')
    expect(math.effectiveRate).toBe('8.9')
    expect(math.total).toBe(89_000n)
  })

  it('still previews at the market rate on step 1', () => {
    const math = computeMath(
      { ...prepaidNoWallet, step: 0 },
      {
        wallets: [],
        settlementCurrency: SETTLEMENT,
        rateMode: 'AVG_COST',
        previewAtMarket: true,
      },
      MARKET,
    )
    expect(math.rateSource).toBe('MARKET_SNAPSHOT')
  })

  it('is ignored in MARKET mode, like every other per-member cost', () => {
    const math = computeMath(
      prepaidNoWallet,
      { wallets: [], settlementCurrency: SETTLEMENT, rateMode: 'MARKET' },
      MARKET,
    )
    expect(math.rateSource).toBe('MARKET_SNAPSHOT')
    expect(math.effectiveRate).toBe('9.1405')
  })

  it('falls back to the market rate until a rate is actually typed', () => {
    const math = computeMath(
      { ...prepaidNoWallet, ownRate: '' },
      { wallets: [], settlementCurrency: SETTLEMENT, rateMode: 'AVG_COST' },
      MARKET,
    )
    expect(math.rateSource).toBe('MARKET_SNAPSHOT')
  })
})

describe('what is left to enter, while typing items', () => {
  const withItems = (
    items: { unitAmount: string; quantity?: number }[],
  ): WizardState =>
    state({
      amount: '1500',
      items: items.map((item, index) => ({
        key: index,
        name: `item ${index}`,
        unitAmount: item.unitAmount,
        quantity: item.quantity ?? 1,
        splitMode: 'BY_QUANTITY' as const,
        assignees: [],
      })),
      receiptTotal: '1500',
    })

  /**
   * THE POINT of entering items by hand: a ¥1,500 bill between two people,
   * you remember your own ¥780 drink, and the ¥720 the screen has left over
   * IS your friend's drink. No receipt, no subtraction.
   */
  it("leaves exactly the other person's drink", () => {
    const math = run(withItems([{ unitAmount: '780' }]), false)
    expect(math.remaining).toBe(720n)
  })

  it('falls to zero as the rest is entered', () => {
    const math = run(
      withItems([{ unitAmount: '780' }, { unitAmount: '720' }]),
      false,
    )
    expect(math.remaining).toBe(0n)
  })

  it('goes negative when the items overshoot', () => {
    const math = run(
      withItems([{ unitAmount: '780' }, { unitAmount: '800' }]),
      false,
    )
    expect(math.remaining).toBe(-80n)
  })

  it('counts quantity, not just the unit price', () => {
    const math = run(withItems([{ unitAmount: '500', quantity: 2 }]), false)
    expect(math.remaining).toBe(500n)
  })

  it('is the whole amount before anything is entered', () => {
    expect(run(withItems([]), false).remaining).toBe(1_500n)
  })

  it('is null while a price is unparseable, rather than lying', () => {
    expect(run(withItems([{ unitAmount: 'abc' }]), false).remaining).toBeNull()
  })

  it('unlike `discrepancy`, it does not vanish once the two agree', () => {
    const math = run(
      withItems([{ unitAmount: '780' }, { unitAmount: '720' }]),
      false,
    )
    // `discrepancy` answers "do these disagree?" and is null when they do
    // not — useless for a number meant to be watched down to zero.
    expect(math.discrepancy).toBeNull()
    expect(math.remaining).toBe(0n)
  })
})

describe('a receipt paid from more than one source', () => {
  // 82,000 JPY, of which 50,000 came off the travel card (9.13) and the rest
  // was paid on the spot (9.1405). The bug this exists to stop is charging
  // the whole 82,000 at the card's rate.
  const split = state({
    step: 1,
    amount: '82000',
    extraFunding: [
      {
        key: 1,
        amount: '32000',
        source: { kind: 'PAY_AS_YOU_GO' },
        ownRate: '',
        memberId: '',
      },
    ],
  })

  it('the primary covers whatever the extras leave', () => {
    const math = run(split, false)
    expect(math.primaryAmount).toBe(50_000n)
    expect(math.portions.map((p) => p.amount)).toEqual([50_000n, 32_000n])
    expect(math.portions.map((p) => p.source)).toEqual([
      'WALLET_AVG_COST',
      'MARKET_SNAPSHOT',
    ])
  })

  it('names no single rate, because there is not one', () => {
    const math = run(split, false)
    expect(math.rateSource).toBe('SPLIT_FUNDING')
    expect(math.effectiveRate).toBeNull()
  })

  it('each portion converts at its own rate, and it is not the wallet total', () => {
    // 50,000 x 9.13 = 456,500; 32,000 x 9.1405 = 292,496.
    expect(run(split, false).total).toBe(748_996n)
    // What the app charged before the split existed: all of it at 9.13.
    expect(run(state({ step: 1, amount: '82000' }), false).total).toBe(748_660n)
  })

  it('previews at market on step 1, portions and all', () => {
    const math = run({ ...split, step: 0 }, true)
    expect(math.portions.every((p) => p.rate === '9.1405')).toBe(true)
    expect(math.total).toBe(749_521n)
  })

  it('a portion the payer exchanged themselves prices at their own rate', () => {
    const math = run(
      state({
        step: 1,
        amount: '82000',
        extraFunding: [
          {
            key: 1,
            amount: '32000',
            source: { kind: 'PREPAID_NO_WALLET' },
            ownRate: '950',
            memberId: '',
          },
        ],
      }),
      false,
    )
    expect(math.portions[1].source).toBe('OWN_EXCHANGE_RATE')
    // 50,000 x 9.13 + 32,000 x 9.5 = 456,500 + 304,000.
    expect(math.total).toBe(760_500n)
  })

  it('refuses to price portions that overshoot the expense', () => {
    const math = run(
      state({
        step: 1,
        amount: '10000',
        extraFunding: [
          {
            key: 1,
            amount: '12000',
            source: { kind: 'PAY_AS_YOU_GO' },
            ownRate: '',
            memberId: '',
          },
        ],
      }),
      false,
    )
    expect(math.primaryAmount).toBe(-2_000n)
    expect(math.portions).toEqual([])
    expect(math.total).toBeNull()
  })

  it('an extra covering the whole receipt leaves the primary out entirely', () => {
    const math = run(
      state({
        step: 1,
        amount: '10000',
        extraFunding: [
          {
            key: 1,
            amount: '10000',
            source: { kind: 'PAY_AS_YOU_GO' },
            ownRate: '',
            memberId: '',
          },
        ],
      }),
      false,
    )
    expect(math.portions).toHaveLength(1)
    expect(math.rateSource).toBe('MARKET_SNAPSHOT')
    expect(math.total).toBe(91_405n)
  })
})

/**
 * A top-up made AT THE TILL — the answer to "this card cannot cover the
 * bill" that people actually give. It has to move two things at once: what
 * the card can cover, and what its money cost. The second is the one that
 * used to be thrown away, and it is the one that decides the settlement
 * figure.
 */
describe('a top-up made at the till', () => {
  it('is ignored until both figures are there', () => {
    expect(
      pendingTopUp(state({ topUpAmount: '40000' }), [WALLET], SETTLEMENT),
    ).toBeNull()
    expect(
      pendingTopUp(
        state({ topUpAmount: '', topUpRate: '900' }),
        [WALLET],
        SETTLEMENT,
      ),
    ).toBeNull()
  })

  it('computes what it cost from the rate, in the currency quote unit', () => {
    // 100 JPY = 900 KRW, so ¥40,000 costs ₩360,000.
    expect(
      pendingTopUp(
        state({ topUpAmount: '40000', topUpRate: '900' }),
        [WALLET],
        SETTLEMENT,
      ),
    ).toEqual({ walletId: 'w1', received: 40_000n, paid: 360_000n })
  })

  it('a typed cost wins over the rate', () => {
    expect(
      pendingTopUp(
        state({ topUpAmount: '40000', topUpRate: '900', topUpPaid: '355000' }),
        [WALLET],
        SETTLEMENT,
      )?.paid,
    ).toBe(355_000n)
  })

  it('is not a top-up of a wallet that is not paying', () => {
    expect(
      pendingTopUp(
        state({
          topUpAmount: '40000',
          topUpRate: '900',
          funding: { kind: 'PAY_AS_YOU_GO' },
        }),
        [WALLET],
        SETTLEMENT,
      ),
    ).toBeNull()
  })

  it('BLENDS into the average cost the expense settles at', () => {
    // The card cost ₩456,500 for ¥50,000 (9.13). Another ¥40,000 at 9.00
    // makes ₩816,500 for ¥90,000 = 9.0722…, and a ¥60,000 dinner paid off
    // the card settles at that blend, not at the old 9.13.
    const math = run(
      state({
        step: 1,
        amount: '60000',
        topUpAmount: '40000',
        topUpRate: '900',
      }),
      false,
    )
    expect(math.rateSource).toBe('WALLET_AVG_COST')
    expect(math.effectiveRate).toBe('9.072222222222')
    expect(math.total).toBe(544_334n)
  })

  it('does not touch the preview before the payment question is answered', () => {
    const math = run(
      state({ amount: '60000', topUpAmount: '40000', topUpRate: '900' }),
      true,
    )
    expect(math.rateSource).toBe('MARKET_SNAPSHOT')
  })
})
