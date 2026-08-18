import { getTranslations } from 'next-intl/server'
import { BackLink } from '@/components/BackLink'
import { requireUser } from '@/lib/membership'
import { createGroup } from './actions'
import { GroupForm } from './GroupForm'

export default async function NewGroupPage() {
  const user = await requireUser('/groups/new')
  const t = await getTranslations('groups.new')
  const tCommon = await getTranslations('common')
  const tLoading = await getTranslations('loading')
  return (
    <main className="flex flex-1 flex-col items-center justify-center gap-4 p-8">
      <div className="self-start">
        <BackLink
          href="/groups"
          caption={tLoading('general')}
          label={tCommon('back')}
          testId="back-link"
        />
      </div>
      <h1 className="text-2xl font-bold">{t('title')}</h1>
      <GroupForm
        action={createGroup}
        defaultDisplayName={user.name ?? ''}
        labels={{
          name: t('name'),
          currency: t('currency'),
          destination: {
            country: t('tripCountry'),
            countryNone: t('tripCountryNone'),
            city: t('tripCity'),
            cityNone: t('tripCityNone'),
            help: t('tripHelp'),
            currencyNote: t('tripCurrencyNote', { currency: '{currency}' }),
          },
          displayName: t('displayName'),
          submit: t('submit'),
          cancel: tCommon('cancel'),
        }}
      />
    </main>
  )
}
