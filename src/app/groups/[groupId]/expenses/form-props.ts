import { prisma } from '@/lib/prisma'
import { formatMinor } from '@/lib/format'
import { computeAvgRate, rateToDecimalString } from '@/lib/settlement'
import {
  WALLET_SPEND_SELECT,
  toWalletExpenseRows,
  walletSummaries,
} from '@/lib/wallet-view'
import {
  defaultExpenseCurrency,
  lastFundingByPayer as computeLastFundingByPayer,
} from '@/lib/expense-currency'
import type { FundingSource } from '@/lib/schemas/expense'

export interface FormMember {
  id: string
  name: string
}

/** One "Paid from" option, with everything needed to show its consequence. */
export interface FormWallet {
  id: string
  memberId: string
  type: 'CASH' | 'TRAVEL_CARD' | 'OTHER_PREPAID'
  label: string
  currency: string
  /**
   * This wallet's average cost in STORAGE units (settlement major per 1
   * foreign major), or null when nothing has been loaded onto it yet — in
   * which case spending from it falls back to the market rate.
   */
  avgRate: string | null
  /** Remaining balance, preformatted in the wallet's own currency. */
  balance: string
  /**
   * The same balance in minor units, as a decimal string (bigint does not
   * cross the RSC boundary). What the wizard needs to ask "this is more than
   * that wallet has left — where did the rest come from?"
   */
  balanceMinor: string
  /**
   * The wallet's top-ups so far, as decimal strings of minor units: what
   * they cost (settlement) over what they bought (wallet currency). Together
   * they ARE `avgRate`; they are carried separately so the wizard can blend
   * a top-up made on the spot into the average and preview the rate the save
   * will actually produce.
   */
  topUpPaidMinor: string
  topUpReceivedMinor: string
  /** Spent past zero: the recorded top-ups are probably incomplete. */
  overdrawn: boolean
}

/**
 * A parse carried over from a handoff link
 * (`?draftAmount=&draftNote=&draftCurrency=`), resolved and validated by
 * `new/page.tsx` (see `new/prefill.ts`'s `resolvePrefill`). NOTHING IN THE
 * APP PRODUCES SUCH A LINK any more — the chat composer that did went on
 * 2026-08-21 — so this path is reachable only by typing the query string.
 * It is kept because the draft-vs-handoff precedence below is tangled with
 * a fixed timezone bug, not because anything needs it.
 *
 * `amount` is the only field gated on validity: a `draftAmount` that fails
 * `parseAmountToMinor` drops `amount` alone, not the whole prefill — currency
 * and note are independently well-formed and still worth carrying over. A
 * `prefill` object being present at all (even with `amount` absent) means
 * there WAS a handoff attempt; its absence from `ExpenseFormDefaults` means
 * there was none.
 */
export interface ExpensePrefill {
  amount?: string
  currency: string
  note: string
}

export interface ExpenseFormDefaults {
  currency: string
  payerId: string
  settlementCurrency: string
  /** Server "now" as an absolute instant — the device rewrites it on mount. */
  nowIso: string
  rateMode: 'AVG_COST' | 'MARKET'
  /** Each member's most recently used funding source. */
  lastFundingByPayer: Record<string, FundingSource>
  meId: string
  /**
   * Set by `new/page.tsx`, not by `buildFormProps` — it depends on the
   * request's query string, not on any server data.
   */
  prefill?: ExpensePrefill
}

export interface ExpenseFormData {
  members: FormMember[]
  wallets: FormWallet[]
  defaults: ExpenseFormDefaults
}

/**
 * Server-side prep for the expense wizard: current members, every member's
 * wallets with the rate and balance each one implies, and the "30 seconds"
 * defaults (most recent currency and payer, each payer's last funding
 * source).
 *
 * Copy is NOT prepared here any more — the wizard is a client component under
 * the root `NextIntlClientProvider`, so it reads i18n keys directly instead
 * of receiving sixty pre-translated label props.
 *
 * No wall-clock strings are built here: the server's timezone is not the
 * user's (Phase 3C). Only an absolute instant crosses the boundary.
 */
export async function buildFormProps(
  groupId: string,
  meId: string,
  /**
   * The expense being EDITED, whose own portions must not count against the
   * wallets they came from. Without this a wallet reads as already drained by
   * the very expense on screen, so re-opening a ¥50,000 card's ¥50,000 dinner
   * says the card has nothing left and asks where the money came from — a
   * question its own answer created.
   */
  excludeExpenseId?: string,
): Promise<ExpenseFormData> {
  const [group, members, recentExpenses, wallets, records, walletExpenses] =
    await Promise.all([
      prisma.group.findUniqueOrThrow({ where: { id: groupId } }),
      prisma.member.findMany({
        where: { groupId, leftAt: null },
        orderBy: { name: 'asc' },
        select: { id: true, name: true },
      }),
      // Ordered by event time (timestamp), not write time (createdAt): the
      // currency default's 24-hour freshness rule and the payer/funding
      // defaults' future-dating guard are both about when money was spent.
      // Cancelled expenses are excluded: they should not steer any default.
      prisma.expense.findMany({
        where: { groupId, cancelledAt: null },
        orderBy: [{ timestamp: 'desc' }, { id: 'desc' }],
        take: 100,
        select: {
          payerId: true,
          currency: true,
          timestamp: true,
          // The primary source only: the wizard's "paid from" default is one
          // answer, and position 0 is the one it would have offered before a
          // receipt could be split.
          funding: {
            select: { walletId: true },
            orderBy: { position: 'asc' },
            take: 1,
          },
        },
      }),
      prisma.wallet.findMany({
        where: { member: { groupId } },
        orderBy: { createdAt: 'asc' },
      }),
      prisma.exchangeRecord.findMany({
        where: { member: { groupId } },
        select: {
          walletId: true,
          amountPaid: true,
          amountReceived: true,
          currency: true,
        },
      }),
      prisma.expenseFunding.findMany({
        where: {
          expense: { groupId },
          walletId: { not: null },
          ...(excludeExpenseId ? { expenseId: { not: excludeExpenseId } } : {}),
        },
        select: WALLET_SPEND_SELECT,
      }),
    ])

  const now = new Date()

  const walletInfos = wallets.map((wallet) => ({
    id: wallet.id,
    memberId: wallet.memberId,
    type: wallet.type,
    label: wallet.label,
    currency: wallet.currency,
  }))
  const summaries = walletSummaries(
    walletInfos,
    records,
    toWalletExpenseRows(walletExpenses),
  )

  const formWallets: FormWallet[] = summaries.map((summary) => {
    const walletRecords = records.filter((r) => r.walletId === summary.walletId)
    const { rate, usedFallback } = computeAvgRate(walletRecords, {
      numerator: 1n,
      denominator: 1n,
    })
    return {
      id: summary.walletId,
      memberId:
        walletInfos.find((w) => w.id === summary.walletId)?.memberId ?? '',
      type: summary.type,
      label: summary.label,
      currency: summary.currency,
      balanceMinor: summary.remaining.toString(),
      // 12 decimals, not the 4 a human reads: this string is what the
      // preview CONVERTS with, and the server converts with the exact
      // rational, so the two must not disagree at the minor unit.
      avgRate:
        usedFallback || summary.currency === group.settlementCurrency
          ? null
          : rateToDecimalString(
              rate,
              group.settlementCurrency,
              summary.currency,
              12,
            ),
      balance: formatMinor(summary.remaining, summary.currency),
      topUpPaidMinor: walletRecords
        .reduce((sum, record) => sum + record.amountPaid, 0n)
        .toString(),
      topUpReceivedMinor: walletRecords
        .reduce((sum, record) => sum + record.amountReceived, 0n)
        .toString(),
      overdrawn: summary.overdrawn,
    }
  })

  return {
    members,
    wallets: formWallets,
    defaults: {
      currency: defaultExpenseCurrency({
        recent: recentExpenses[0]
          ? {
              currency: recentExpenses[0].currency,
              at: recentExpenses[0].timestamp,
            }
          : null,
        now,
        tripCurrency: group.tripCurrency,
        settlementCurrency: group.settlementCurrency,
      }),
      // The person entering an expense is almost always the person who paid
      // for it — they are the one holding the receipt. That beats guessing
      // from history, which answered with whoever paid LAST TIME and so was
      // wrong for everyone but the group's habitual payer. `requireGroupMember`
      // has already established that this member belongs to this group.
      payerId: meId,
      settlementCurrency: group.settlementCurrency,
      nowIso: now.toISOString(),
      rateMode: group.rateMode,
      lastFundingByPayer: computeLastFundingByPayer(
        recentExpenses.map((expense) => ({
          payerId: expense.payerId,
          walletId: expense.funding[0]?.walletId ?? null,
          timestamp: expense.timestamp,
        })),
        now,
      ),
      meId,
    },
  }
}
