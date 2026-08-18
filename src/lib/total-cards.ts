import type { BreakdownRowView } from '@/components/TotalCard'
import { toEngineExpense } from '@/lib/engine-map'
import { formatMinor } from '@/lib/format'
import type { loadGroupData } from '@/lib/group-data'
import {
  frontedBreakdown,
  shareBreakdown,
  type RateBreakdown,
  type RateRow,
} from '@/lib/rate-breakdown'
import { quoteUnitFor, storageRateToDisplay } from '@/lib/rate-units'
import { rateToDecimalString } from '@/lib/settlement'

/**
 * The slice of `loadGroupData`'s return value the totals builder needs.
 * Same `Pick` pattern as `feed-rows.ts`'s `GroupData` — home and status each
 * pass only what they already have in scope.
 */
export type GroupData = Pick<
  Awaited<ReturnType<typeof loadGroupData>>,
  'group' | 'expenses' | 'mode' | 'context'
>

/** A next-intl translator function, scoped to the `home` namespace. */
export type Translator = (
  key: string,
  values?: Record<string, string | number>,
) => string

/** View props for one `TotalCard`, minus its icon and testId (caller-fixed). */
export interface TotalCardData {
  label: string
  hint: string
  primary: string
  secondary: string | null
  expandLabel: string
  totalLabel: string
  emptyLabel: string
  rows: BreakdownRowView[]
  totalRow: BreakdownRowView
}

/**
 * Builds the two headline TotalCards' view props ("you fronted" / "your
 * share") — extracted verbatim from home's `page.tsx` so home and status can
 * never drift apart on what those two figures mean or how their breakdown
 * rows are labelled. `t` is the `home` namespace translator.
 */
export function buildTotalCards(
  data: GroupData,
  meId: string,
  members: { id: string; name: string }[],
  t: Translator,
): { fronted: TotalCardData; consumed: TotalCardData } {
  const { group, expenses, mode, context } = data
  const currency = group.settlementCurrency

  // My aggregates include personal expenses (own spending view); cancelled
  // expenses never count anywhere. `engineExpenses` (not used here) has
  // already dropped cancelled ones, but it also drops PERSONAL ones, which
  // these two totals are supposed to include — so they are built from the
  // full list.
  const mine = expenses
    .filter((expense) => expense.cancelledAt === null)
    .map(toEngineExpense)
  const fronted = frontedBreakdown(meId, mine, mode, context)
  const share = shareBreakdown(meId, mine, mode, context)
  // The headline IS the fold of the rows — never a second sum that could
  // round differently. (`convertExpense`/`consumedShares` are still what
  // produced each row; see rate-breakdown.ts.)

  /** "Travel card", "On the spot", "Sota's cash" — never a bare number. */
  const rowLabel = (row: RateRow): string => {
    if (row.source === 'SPLIT_FUNDING') return t('breakdownSplit')
    if (row.source === 'OWN_EXCHANGE_RATE') return t('breakdownOwnRate')
    if (row.source === 'ACTUAL_CHARGED') return t('breakdownBankCharged')
    if (row.walletLabel === undefined) return t('breakdownOnTheSpot')
    return row.rateOwnerId === meId
      ? row.walletLabel
      : t('breakdownOwned', {
          name: members.find((m) => m.id === row.rateOwnerId)?.name ?? '?',
          wallet: row.walletLabel,
        })
  }

  /** Every row states the rate that produced it. No bare converted number. */
  const rowRate = (row: RateRow): string => {
    if (row.currency === currency) return t('breakdownNoRate')
    // A share of a receipt paid from two pockets has no one rate behind it,
    // and the blended factor that priced it is not a rate anyone was
    // charged. Naming the sources is the honest answer.
    if (row.source === 'SPLIT_FUNDING') return t('breakdownSplitRate')
    const unit = quoteUnitFor(row.currency)
    return t('breakdownRate', {
      unit: unit === 1 ? '' : unit.toLocaleString('en'),
      currency: row.currency,
      rate:
        storageRateToDisplay(
          rateToDecimalString(row.rate, currency, row.currency, 4),
          row.currency,
        ) ?? '?',
      settlement: currency,
    })
  }

  const toRows = (breakdown: RateBreakdown): BreakdownRowView[] =>
    breakdown.rows.map((row) => ({
      key: row.key,
      label: rowLabel(row),
      rate: rowRate(row),
      spend:
        row.currency === currency ? null : formatMinor(row.spend, row.currency),
      settlement: formatMinor(row.settlement, currency),
    }))

  const totalRowFor = (breakdown: RateBreakdown): BreakdownRowView => ({
    key: 'total',
    label: '',
    rate: '',
    spend: breakdown.totalSpend
      ? formatMinor(breakdown.totalSpend.amount, breakdown.totalSpend.currency)
      : null,
    settlement: formatMinor(breakdown.totalSettlement, currency),
  })

  /**
   * The big figure is the SPEND currency when the whole trip shares one —
   * that is the number on the receipts. A mixed-currency trip has no honest
   * single spend figure (adding yen to won needs a rate this app has never
   * had), so it leads with settlement instead.
   */
  const headline = (breakdown: RateBreakdown) =>
    breakdown.totalSpend
      ? {
          primary: formatMinor(
            breakdown.totalSpend.amount,
            breakdown.totalSpend.currency,
          ),
          secondary: formatMinor(breakdown.totalSettlement, currency),
        }
      : {
          primary: formatMinor(breakdown.totalSettlement, currency),
          secondary: null,
        }

  return {
    fronted: {
      label: t('totalPaid'),
      hint: t('totalPaidHint'),
      expandLabel: t('breakdownExpand', { label: t('totalPaid') }),
      totalLabel: t('breakdownTotal'),
      emptyLabel: t('breakdownEmpty'),
      rows: toRows(fronted),
      totalRow: totalRowFor(fronted),
      ...headline(fronted),
    },
    consumed: {
      label: t('totalConsumed'),
      hint: t('totalConsumedHint'),
      expandLabel: t('breakdownExpand', { label: t('totalConsumed') }),
      totalLabel: t('breakdownTotal'),
      emptyLabel: t('breakdownEmpty'),
      rows: toRows(share),
      totalRow: totalRowFor(share),
      ...headline(share),
    },
  }
}
