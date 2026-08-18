import { toEngineExpense } from '@/lib/engine-map'
import type { loadGroupData } from '@/lib/group-data'
import {
  computeNetBalances,
  convertExpense,
  pairwiseNetFor,
  simplifyDebts,
} from '@/lib/settlement'
import { frontedBreakdown, shareBreakdown } from '@/lib/rate-breakdown'
import { fundingRowsOf, walletSummaries } from '@/lib/wallet-view'

/**
 * The ONE server module the assistant-brain plan allows (spec §5.5): the
 * settlement engine needs Prisma-loaded data (`loadGroupData`) and does
 * bigint arithmetic, neither of which can run in `ChatComposer` (a client
 * component) — but `bigint` cannot cross the server → client boundary as a
 * prop in this app's established convention (every other screen formats or
 * stringifies before handing settlement figures to a client component; see
 * `total-cards.ts`, `StatusRow`, `feed-rows.ts`). So every amount here is a
 * decimal-string minor-units value, and `ChatComposer` does
 * `BigInt(value)` right before handing it to the (pure, bigint-typed)
 * composer functions in `src/lib/assistant/compose.ts`.
 *
 * Deliberately NOT `buildTotalCards` (spec's own §1 table names it for the
 * group total, but T6's brief rules it out): that function needs a
 * translator and returns pre-formatted display strings for a very different
 * UI (the two headline TotalCards), nothing here wants that shape. The
 * group/spending totals below are folded straight from the engine's own
 * bigint outputs instead, the same building blocks `buildTotalCards` itself
 * uses (`convertExpense`, `frontedBreakdown`, `shareBreakdown`).
 */

export interface AssistantWalletView {
  walletId: string
  label: string
  currency: string
  /** Decimal-string bigint; already signed (negative when overdrawn). */
  remaining: string
  overdrawn: boolean
}

export interface AssistantTransferView {
  from: string
  to: string
  amount: string
}

export interface AssistantData {
  currency: string
  /** Settleable (non-personal, non-cancelled) expense count — the
   *  QUERY_MY_BALANCE `hasExpenses` signal, since `computeNetBalances`'s own
   *  input excludes personal spending. */
  expenseCount: number
  /** Any non-cancelled expense, personal included — the QUERY_MY_SPENDING
   *  `hasExpenses` signal, since `frontedBreakdown`/`shareBreakdown`'s own
   *  input (unlike `expenseCount` above) DOES include personal spending
   *  (matches `total-cards.ts`'s own "my aggregates include personal
   *  expenses" rule). Using `expenseCount` here instead would silently
   *  report "empty" on a group whose only expenses are personal. */
  hasAnyExpenses: boolean
  /** The full settle-up plan (`simplifyDebts`), unfiltered — the query-side
   *  composers filter to the actor themselves. */
  transfers: AssistantTransferView[]
  groupTotal: string
  myPaid: string
  myConsumed: string
  /** `computeNetBalances(...).get(actorId)` — positive = the actor owes. */
  myNet: string
  /** The actor's net position against every OTHER member; positive = the
   *  actor owes that member (same convention as `myNet`/`pairwiseNetFor`). */
  pairwiseNet: Record<string, string>
  /** The actor's own wallets only (mirrors QUERY_WALLET's scope, spec §1). */
  wallets: AssistantWalletView[]
  /** id → display name for EVERY member the group has ever had, departed
   *  included (review I2) — a settle-up transfer or pairwise line can name
   *  someone who has since left, and the client's own `members` prop is
   *  filtered to active members only (`page.tsx`'s `chatMembers`). Without
   *  this, a departed member's name in a transfer line silently falls back
   *  to their raw id (composeMyBalance/composeGroupTotal's own `nameOf`
   *  default), which is a cuid, not a name. */
  names: Record<string, string>
  /** Distinct participant ids across the SAME settleable expense set
   *  `groupTotal` was folded from (review M5) — the group-total "per
   *  person" denominator. Deliberately NOT the count of currently-active
   *  members: a departed member's expenses still count toward the total,
   *  so excluding them from the denominator (or including an active member
   *  who was never in any of these expenses) would skew 인당 either way. */
  groupParticipantCount: number
}

export function buildAssistantData(
  data: Awaited<ReturnType<typeof loadGroupData>>,
  actorId: string,
): AssistantData {
  const { group, members, expenses, engineExpenses, context, mode } = data
  const currency = group.settlementCurrency

  const names: Record<string, string> = {}
  for (const member of members) {
    names[member.id] = member.name
  }

  const participantIds = new Set<string>()
  for (const expense of engineExpenses) {
    for (const memberId of expense.participantIds) {
      participantIds.add(memberId)
    }
  }

  const balances = computeNetBalances(engineExpenses, mode, context)
  const transfers = simplifyDebts(balances).map((t) => ({
    from: t.from,
    to: t.to,
    amount: t.amount.toString(),
  }))
  const groupTotal = engineExpenses
    .reduce((sum, e) => sum + convertExpense(e, mode, context).amount, 0n)
    .toString()

  // Personal spending counts toward "what I paid"/"my own share" (spec §1
  // QUERY_MY_SPENDING) even though it never enters settlement — same input
  // set `total-cards.ts`'s `buildTotalCards` builds `mine` from.
  const mine = expenses
    .filter((expense) => expense.cancelledAt === null)
    .map(toEngineExpense)
  const myPaid = frontedBreakdown(
    actorId,
    mine,
    mode,
    context,
  ).totalSettlement.toString()
  const myConsumed = shareBreakdown(
    actorId,
    mine,
    mode,
    context,
  ).totalSettlement.toString()

  const pairwise = pairwiseNetFor(actorId, engineExpenses, mode, context)
  const pairwiseNet: Record<string, string> = {}
  for (const [memberId, net] of pairwise) {
    pairwiseNet[memberId] = net.toString()
  }

  const myWallets = [...context.walletsById.values()].filter(
    (wallet) => wallet.memberId === actorId,
  )
  const allRecords = [...context.recordsByWallet.values()].flat()
  // A wallet is drawn down by the PORTIONS funded from it, not by the
  // totals of the expenses it part-paid (same rule `status/page.tsx` uses).
  const walletRows = fundingRowsOf(expenses)
  const wallets = walletSummaries(myWallets, allRecords, walletRows).map(
    (w) => ({
      walletId: w.walletId,
      label: w.label,
      currency: w.currency,
      remaining: w.remaining.toString(),
      overdrawn: w.overdrawn,
    }),
  )

  return {
    currency,
    expenseCount: engineExpenses.length,
    hasAnyExpenses: expenses.some((expense) => expense.cancelledAt === null),
    transfers,
    groupTotal,
    myPaid,
    myConsumed,
    myNet: (balances.get(actorId) ?? 0n).toString(),
    pairwiseNet,
    wallets,
    names,
    groupParticipantCount: participantIds.size,
  }
}
