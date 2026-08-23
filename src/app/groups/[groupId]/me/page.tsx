import { getTranslations } from 'next-intl/server'
import { formatMinor } from '@/lib/format'
import { loadGroupData } from '@/lib/group-data'
import { requireGroupMember } from '@/lib/membership'
import { mySpending } from '@/lib/my-spending'
import { Money } from '@/components/Money'
import { DayList } from './DayList'

export default async function MySpendingPage({
  params,
}: {
  params: Promise<{ groupId: string }>
}) {
  const { groupId } = await params
  const { member: me } = await requireGroupMember(groupId)
  const data = await loadGroupData(groupId)
  const t = await getTranslations('myspending')
  const tDetail = await getTranslations('expenses.detail')
  const tEmpty = await getTranslations('empty')
  const tLoading = await getTranslations('loading')

  // Personal expenses included: this is "what I ate/used", not settlement.
  const { rows, total, currency } = mySpending(data, me.id)

  return (
    <main className="flex flex-1 flex-col gap-8 px-5 py-6">
      <h1 className="text-sm font-medium text-muted-foreground">
        {t('title')}
      </h1>
      {rows.length === 0 ? (
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
          <DayList
            groupId={groupId}
            rows={rows}
            personalBadge={tDetail('personalBadge')}
            openCaption={tLoading('expense')}
          />
        </>
      )}
    </main>
  )
}
