import { getTranslations } from 'next-intl/server'
import { requestPasswordReset } from './actions'
import { RequestResetForm } from './ResetForms'

export default async function ResetPasswordPage() {
  const t = await getTranslations('auth.reset')
  return (
    <main className="flex flex-1 flex-col items-center justify-center gap-4 p-8">
      <h1 className="text-2xl font-bold">{t('title')}</h1>
      <RequestResetForm
        action={requestPasswordReset}
        emailLabel={t('email')}
        submitLabel={t('request')}
        doneMessage={t('requested')}
      />
    </main>
  )
}
