import type { FeedRowView } from '@/components/ExpenseFeed'
import { toEngineExpense } from '@/lib/engine-map'
import { feedShareFor } from '@/lib/feed-share'
import type { loadGroupData } from '@/lib/group-data'
import { rateChipCopy } from '@/lib/rate-chip'
import { convertExpense } from '@/lib/settlement'

/**
 * The slice of `loadGroupData`'s return value the feed builder needs.
 * Kept as a `Pick` (not the full return type) so home and history can each
 * pass only what they already have in scope.
 */
export type GroupData = Pick<
  Awaited<ReturnType<typeof loadGroupData>>,
  'group' | 'expenses' | 'mode' | 'context'
>

/** A next-intl translator function, scoped to one namespace. */
export type Translator = (
  key: string,
  values?: Record<string, string | number>,
) => string

/** Formats an integer minor-unit amount for display in its currency. */
export type Formatter = (amount: bigint, currency: string) => string

/**
 * Builds the feed rows the history screen renders from — extracted verbatim
 * from `page.tsx` (back when home shared this code path too) so history's
 * row markup and i18n keys stay identical to what it replaced. `t` is the
 * `home` namespace translator (item counts, entered-by/cancelled-by,
 * even-split, rest-of-bill); `tChip` is `rateChip` (the rate-source badge
 * text). See `expenses/actions.ts`'s `stay` branch, which builds a matching
 * `FeedRowView` by hand for the same reason (docs/SOLVED.md 2026-08-09
 * "React dropped the refresh's re-render") — any drift between that row and
 * this one is a visible "pop" when rows swap.
 *
 * History is the only caller and always wants the full list, so there is no
 * cap parameter here. The wallet-adjustment FILTER below is not an option:
 * including those rows needs its own design and copy, so it stays
 * unconditional here.
 */
export function buildFeedRows(
  data: GroupData,
  meId: string,
  t: Translator,
  tChip: Translator,
  fmt: Formatter,
): FeedRowView[] {
  const { group, expenses, mode, context } = data
  const currency = group.settlementCurrency
  const groupId = group.id

  // A wallet correction is bookkeeping ABOUT a wallet, not something the
  // group bought — it belongs to the wallet screen that produced it, and
  // in a feed of purchases it reads as a purchase nobody made.
  const eligible = expenses.filter((expense) => !expense.isWalletAdjustment)

  return eligible.map((expense) => {
    const cancelled = expense.cancelledAt !== null
    const engineExpense = toEngineExpense(expense)
    const converted = cancelled
      ? null
      : convertExpense(engineExpense, mode, context)
    const source = converted?.source ?? null
    // The figure on the row is MINE, not the receipt's.
    const share = feedShareFor(engineExpense, meId)
    const showChip =
      source !== null &&
      (expense.currency !== currency || source === 'ACTUAL_CHARGED')
    return {
      id: expense.id,
      href: `/groups/${groupId}/expenses/${expense.id}`,
      title: expense.title || expense.payer.name,
      meta: `${expense.payer.name} · ${t('itemCount', {
        count: expense.items.length,
      })} · ${
        cancelled && expense.cancelledBy
          ? t('cancelledBy', { name: expense.cancelledBy.name })
          : t('enteredByShort', { name: expense.enteredBy.name })
      }`,
      amount: fmt(share?.total ?? 0n, expense.currency),
      receiptTotal: fmt(expense.amount, expense.currency),
      none: share === null,
      evenSplit: share?.evenSplitOf
        ? t('feedEvenSplit', { count: share.evenSplitOf.among })
        : null,
      cancelled,
      chip:
        showChip && converted !== null
          ? rateChipCopy(converted, tChip).label
          : null,
      // "What did I have again?" is answered by my own lines. The units
      // stated are the ones I took, not what the line held — a beer ×2 out
      // of six is what I drank.
      items: (share?.lines ?? []).map((line) => ({
        key: line.key,
        name:
          line.name === null
            ? t('feedRest')
            : line.splitMode === 'BY_QUANTITY' && line.units > 1
              ? `${line.name} ×${line.units}`
              : line.name,
        amount: fmt(line.amount, expense.currency),
      })),
    }
  })
}
