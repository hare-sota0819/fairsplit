import Link from 'next/link'
import { getTranslations } from 'next-intl/server'
import { CredentialsForm } from '@/components/AuthForms'
import { SubmitButton } from '@/components/SubmitButton'

import { signInWithGoogle, signInWithPassword } from './actions'

export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<{ callbackUrl?: string }>
}) {
  const { callbackUrl = '/' } = await searchParams
  const t = await getTranslations('auth.signIn')
  const googleAction = signInWithGoogle.bind(null, callbackUrl)
  return (
    <main className="flex flex-1 flex-col items-center justify-center gap-4 p-8">
      <h1 className="text-2xl font-bold">{t('title')}</h1>
      <form action={googleAction}>
        <SubmitButton variant="outline" size="hero" className="w-72">
          {t('google')}
        </SubmitButton>
      </form>
      <CredentialsForm
        action={signInWithPassword}
        fields={['email', 'password']}
        labels={{ email: t('email'), password: t('password') }}
        submitLabel={t('submit')}
        callbackUrl={callbackUrl}
      />
      <p className="text-sm text-muted-foreground">
        {t('noAccount')}{' '}
        <Link
          className="text-primary underline"
          href={`/signup?callbackUrl=${encodeURIComponent(callbackUrl)}`}
        >
          {t('signUpLink')}
        </Link>{' '}
        ·{' '}
        <Link className="text-primary underline" href="/reset-password">
          {t('forgot')}
        </Link>
      </p>
    </main>
  )
}
