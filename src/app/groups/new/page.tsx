import { getTranslations } from 'next-intl/server'
import { BackLink } from '@/components/BackLink'
import { requireUser } from '@/lib/membership'
import { createGroup } from './actions'
import { GroupForm } from './GroupForm'

/**
 * /groups/new — the whole screen asks one question (the mockup's "이름 하나면
 * 장부가 열립니다"): a 514px statement column, serif 400 title, the meta
 * sentence, one field, one primary action. Currency, member name and
 * destination are derived or deferred — see actions.ts.
 */
export default async function NewGroupPage() {
  await requireUser('/groups/new')
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
      <p className="mt-2.5 text-sm leading-6 text-[#8a8a8a]">{t('meta')}</p>
      <div className="mt-14">
        <GroupForm
          action={createGroup}
          labels={{
            name: t('name'),
            namePlaceholder: t('namePlaceholder'),
            submit: t('submit'),
            cancel: t('cancel'),
          }}
        />
      </div>
    </main>
  )
}
