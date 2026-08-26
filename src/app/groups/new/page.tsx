import { getTranslations } from 'next-intl/server'
import { BackLink } from '@/components/BackLink'
import { requireUser } from '@/lib/membership'
import { createGroup } from './actions'
import { GroupForm } from './GroupForm'

/**
 * /groups/new — one centered statement column (FIXES-DESKTOP §2): 514px,
 * serif 400 title, a meta sentence, then the form. The column is the page;
 * there is no card and nothing else on the desk.
 */
export default async function NewGroupPage() {
  const user = await requireUser('/groups/new')
  const t = await getTranslations('groups.new')
  const tCommon = await getTranslations('common')
  const tLoading = await getTranslations('loading')
  return (
    <main className="mx-auto flex w-full max-w-[514px] flex-1 flex-col px-5 py-10 sm:py-14">
      <div className="-ml-1 self-start">
        <BackLink
          href="/groups"
          caption={tLoading('general')}
          label={tCommon('back')}
          testId="back-link"
        />
      </div>
      <h1 className="mt-8 font-heading text-2xl font-normal tracking-[-0.01em] text-foreground">
        {t('title')}
      </h1>
      <div className="mt-12">
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
      </div>
    </main>
  )
}
