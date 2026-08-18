import { getTranslations } from 'next-intl/server'
import { BackLink } from '@/components/BackLink'
import { requireGroupMember } from '@/lib/membership'
import { saveExpense } from '../actions'
import { ExpenseForm } from '../ExpenseForm'
import { buildFormProps, type ExpenseFormData } from '../form-props'
import { resolvePrefill, type SearchParamValue } from './prefill'

export default async function NewExpensePage({
  params,
  searchParams,
}: {
  params: Promise<{ groupId: string }>
  // Honest to what Next.js actually hands back: a repeated key (`?a=1&a=2`)
  // resolves to a string[], not a string — see `resolvePrefill`'s guard.
  searchParams: Promise<{ [key: string]: SearchParamValue }>
}) {
  const { groupId } = await params
  const { member: me } = await requireGroupMember(groupId)
  const [rawData, sp, t, tLoading, tCommon] = await Promise.all([
    buildFormProps(groupId, me.id),
    searchParams,
    getTranslations('expenses.new'),
    getTranslations('loading'),
    getTranslations('common'),
  ])
  const prefill = resolvePrefill(rawData.defaults.settlementCurrency, sp)
  const data: ExpenseFormData = prefill
    ? { ...rawData, defaults: { ...rawData.defaults, prefill } }
    : rawData
  return (
    <main className="flex flex-1 flex-col">
      <div className="px-5 pt-5">
        <BackLink
          href={`/groups/${groupId}`}
          caption={tLoading('group')}
          label={tCommon('back')}
          testId="back-link"
        />
      </div>
      <h1 className="px-5 pt-5 text-xl font-bold">{t('title')}</h1>
      <ExpenseForm groupId={groupId} action={saveExpense} data={data} />
    </main>
  )
}
