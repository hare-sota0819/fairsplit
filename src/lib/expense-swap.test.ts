import { describe, expect, it } from 'vitest'
import { currencySwapBlockedKey, type SwapFundingRow } from './expense-swap'

/**
 * The chat currency swap's refusal set, as a pure function so every shape it
 * must decline is pinned by a test rather than by prose in the action — the
 * `expense-cancel.ts` precedent ("prose drifts, a test does not").
 */
describe('currencySwapBlockedKey', () => {
  const plainFunding = (): SwapFundingRow[] => [
    {
      actualChargedAmount: null,
      walletId: null,
      ownRateSnapshot: null,
      funderId: null,
    },
  ]
  const plain = () => ({ itemCount: 0, isWalletAdjustment: false })

  it('allows the ordinary shape: one plain pay-as-you-go portion, no items', () => {
    expect(currencySwapBlockedKey(plain(), plainFunding(), 'JPY')).toBeNull()
  })

  it('refuses an ITEMISED expense — its line totals ARE the receipt', () => {
    expect(
      currencySwapBlockedKey(
        { itemCount: 3, isWalletAdjustment: false },
        plainFunding(),
        'JPY',
      ),
    ).toBe('chat.edit.tooComplex')
  })

  it('refuses a wallet adjustment — a counted-cash correction is its wallet’s own money', () => {
    expect(
      currencySwapBlockedKey(
        { itemCount: 0, isWalletAdjustment: true },
        plainFunding(),
        'JPY',
      ),
    ).toBe('chat.edit.tooComplex')
  })

  it('refuses split funding and a receipt with no funding at all', () => {
    expect(
      currencySwapBlockedKey(
        plain(),
        [...plainFunding(), ...plainFunding()],
        'JPY',
      ),
    ).toBe('chat.edit.tooComplex')
    expect(currencySwapBlockedKey(plain(), [], 'JPY')).toBe(
      'chat.edit.tooComplex',
    )
  })

  it('refuses a portion already corrected against a bank statement', () => {
    expect(
      currencySwapBlockedKey(
        plain(),
        [
          {
            actualChargedAmount: 41_000n,
            walletId: null,
            ownRateSnapshot: null,
            funderId: null,
          },
        ],
        'JPY',
      ),
    ).toBe('chat.edit.tooComplex')
  })

  /**
   * Review round 1, IMPORTANT 1. A wallet-funded (or own-rate) portion cannot
   * be carried over: a wallet holds ONE currency, so the pot that paid the old
   * row cannot have paid the new one, and the swap's single confirm card has
   * nowhere to ask which pot did. Re-creating it as an on-the-spot expense
   * would move the wallet's balance and its average cost without saying so —
   * so the swap declines and points at the full form instead.
   */
  it('refuses a WALLET-FUNDED target rather than silently resetting it to on-the-spot', () => {
    expect(
      currencySwapBlockedKey(
        plain(),
        [
          {
            actualChargedAmount: null,
            walletId: 'w1',
            ownRateSnapshot: null,
            funderId: null,
          },
        ],
        'JPY',
      ),
    ).toBe('chat.edit.tooComplex')
  })

  it('refuses a portion carrying the payer’s OWN exchange rate, for the same reason', () => {
    expect(
      currencySwapBlockedKey(
        plain(),
        [
          {
            actualChargedAmount: null,
            walletId: null,
            ownRateSnapshot: '9.5',
            funderId: null,
          },
        ],
        'JPY',
      ),
    ).toBe('chat.edit.tooComplex')
  })

  /**
   * Review round 2 — the same bug as the wallet one, on the last funding
   * column the re-create discards. A receipt somebody ELSE fronted entirely
   * is one portion with `funderId` set, and the re-create hardcodes
   * `funderId: null` — which is "the payer" (schema, and
   * `balances.ts`'s `portion.funding.memberId ?? expense.payerId`). Swapping
   * the currency would have moved the whole receipt's credit off the
   * co-funder and onto the payer, silently.
   */
  it('refuses a portion somebody OTHER than the payer fronted', () => {
    expect(
      currencySwapBlockedKey(
        plain(),
        [
          {
            actualChargedAmount: null,
            walletId: null,
            ownRateSnapshot: null,
            funderId: 'm2',
          },
        ],
        'JPY',
      ),
    ).toBe('chat.edit.tooComplex')
  })

  /**
   * Minor 8. The currency arrives from PARSED TEXT, and `minorUnitDigits`
   * throws on a code ISO 4217 does not know — a throw would reach the user as
   * the generic "something went wrong" instead of as the reason. Every code
   * `classify()` can emit is a real one, so this is defence in depth, not a
   * path a sentence reaches today.
   */
  it('refuses a currency the ISO 4217 table does not know', () => {
    expect(currencySwapBlockedKey(plain(), plainFunding(), 'XYZ')).toBe(
      'chat.edit.badAmount',
    )
    expect(currencySwapBlockedKey(plain(), plainFunding(), '')).toBe(
      'chat.edit.badAmount',
    )
  })

  it('checks the currency BEFORE the shapes, so an unknown code never reads as “too complex”', () => {
    expect(
      currencySwapBlockedKey(
        { itemCount: 3, isWalletAdjustment: false },
        [],
        'XYZ',
      ),
    ).toBe('chat.edit.badAmount')
  })
})
