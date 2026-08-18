import { getTranslations } from 'next-intl/server'
import { resetPassword } from '../actions'
import { ConfirmResetForm } from '../ResetForms'

export default async function ConfirmResetPage({
  params,
}: {
  params: Promise<{ token: string }>
}) {
  const { token } = await params
  const t = await getTranslations('auth')
  return (
    <main className="flex flex-1 flex-col items-center justify-center gap-4 p-8">
      <h1 className="text-2xl font-bold">{t('reset.title')}</h1>
      <ConfirmResetForm
        action={resetPassword}
        token={token}
        passwordLabel={t('reset.newPassword')}
        submitLabel={t('reset.submit')}
        doneMessage={t('reset.done')}
        signInLabel={t('signIn.title')}
      />
    </main>
  )
}
