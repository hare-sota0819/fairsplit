import { getTranslations } from 'next-intl/server'
import { toEngineExpense } from '@/lib/engine-map'
import { formatMinor } from '@/lib/format'
import { loadGroupData } from '@/lib/group-data'
import { requireGroupMember } from '@/lib/membership'
import { consumedShares } from '@/lib/settlement'
import { Money } from '@/components/Money'
import { DayList, type SpendingRow } from './DayList'

export default async function MySpendingPage({
  params,
}: {
  params: Promise<{ groupId: string }>
}) {
  const { groupId } = await params
  const { member: me } = await requireGroupMember(groupId)
  const { group, expenses, context, mode } = await loadGroupData(groupId)
  const t = await getTranslations('myspending')
  const tDetail = await getTranslations('expenses.detail')
  const tEmpty = await getTranslations('empty')
  const currency = group.settlementCurrency

  // Personal expenses included: this is "what I ate/used", not settlement.
  const mine: SpendingRow[] = []
  let total = 0n
  for (const expense of expenses) {
    if (expense.cancelledAt !== null) continue
    const share = consumedShares(toEngineExpense(expense), mode, context).get(
      me.id,
    )
    if (share === undefined || share === 0n) continue
    total += share
    mine.push({
      id: expense.id,
      title: expense.title || expense.payer.name,
      timestampIso: expense.timestamp.toISOString(),
      amount: formatMinor(share, currency),
      personal: expense.isPersonal,
    })
  }

  return (
    <main className="flex flex-1 flex-col gap-8 px-5 py-6">
      <h1 className="text-sm font-medium text-muted-foreground">
        {t('title')}
      </h1>
      {mine.length === 0 ? (
        <p
          className="px-5 py-12 text-center text-sm text-muted-foreground"
          data-testid="spending-empty"
        >
          {tEmpty('noSpending')}
        </p>
      ) : (
        <>
          <header className="flex flex-col gap-2">
            <p className="text-sm text-muted-foreground">{t('total')}</p>
            <span data-testid="my-total">
              <Money size="hero">{formatMinor(total, currency)}</Money>
            </span>
            <p className="text-xs text-muted-foreground">
              {t('personalIncluded')}
            </p>
          </header>
          <DayList rows={mine} personalBadge={tDetail('personalBadge')} />
        </>
      )}
    </main>
  )
}
