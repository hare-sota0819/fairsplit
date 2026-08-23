import { getTranslations } from 'next-intl/server'
import { Money } from '@/components/Money'
import { formatMinor } from '@/lib/format'
import { loadGroupData } from '@/lib/group-data'
import { requireGroupMember } from '@/lib/membership'
import { compareModesReport } from '@/lib/settlement'

/**
 * The same expenses settled both ways, side by side.
 *
 * `compareModesReport` has been pure and tested since Phase 3A with nowhere
 * to show it. Nothing here writes anything: the group's mode is changed in
 * settings, and this screen only says what the other answer would have been.
 */
export default async function ModeComparePage({
  params,
}: {
  params: Promise<{ groupId: string }>
}) {
  const { groupId } = await params
  await requireGroupMember(groupId)
  const { group, members, engineExpenses, context, mode } =
    await loadGroupData(groupId)
  const t = await getTranslations('modeCompare')

  const currency = group.settlementCurrency
  const report = compareModesReport(engineExpenses, context)
  // Signs are kept here, unlike everywhere else in the app: this is a table
  // of three numbers meant to be compared column by column, and stripping the
  // sign would make "up 2,000" and "down 2,000" print identically.
  const signed = (amount: bigint): string => formatMinor(amount, currency)

  return (
    <main className="flex flex-1 flex-col gap-6 px-5 py-6">
      <header className="flex flex-col gap-2">
        <h1 className="text-2xl font-bold">{t('title')}</h1>
        <p className="text-sm text-muted-foreground">{t('intro')}</p>
        <p className="text-sm text-muted-foreground" data-testid="compare-mode">
          {t('current', {
            mode: mode === 'AVG_COST' ? t('avgCost') : t('market'),
          })}
        </p>
      </header>

      {engineExpenses.length === 0 ? (
        <p
          className="text-sm text-muted-foreground"
          data-testid="compare-empty"
        >
          {t('empty')}
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm" data-testid="compare-table">
            <thead>
              <tr className="border-b border-border text-left">
                <th className="py-2 pr-3 font-medium">{t('member')}</th>
                <th className="py-2 pr-3 text-right font-medium">
                  {t('avgCost')}
                </th>
                <th className="py-2 pr-3 text-right font-medium">
                  {t('market')}
                </th>
                <th className="py-2 text-right font-medium">
                  {t('difference')}
                </th>
              </tr>
            </thead>
            <tbody>
              {members.map((member) => (
                <tr key={member.id} className="border-b border-border">
                  <td className="py-2 pr-3">{member.name}</td>
                  <td className="py-2 pr-3 text-right">
                    <Money>
                      {signed(report.avgCost.balances.get(member.id) ?? 0n)}
                    </Money>
                  </td>
                  <td className="py-2 pr-3 text-right">
                    <Money>
                      {signed(report.market.balances.get(member.id) ?? 0n)}
                    </Money>
                  </td>
                  <td className="py-2 text-right">
                    <Money>{signed(report.deltas.get(member.id) ?? 0n)}</Money>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <p className="text-xs text-muted-foreground">{t('note')}</p>
    </main>
  )
}
