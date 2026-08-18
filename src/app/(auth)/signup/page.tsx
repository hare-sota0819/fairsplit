import Link from 'next/link'
import { getLocale, getTranslations } from 'next-intl/server'
import { CredentialsForm } from '@/components/AuthForms'
import { LocaleToggle } from '@/components/LocaleToggle'
import { SubmitButton } from '@/components/SubmitButton'
import type { Locale } from '@/i18n/locale'
import { signInWithGoogle } from '../signin/actions'
import { signUp } from './actions'

export default async function SignUpPage({
  searchParams,
}: {
  searchParams: Promise<{ callbackUrl?: string }>
}) {
  const { callbackUrl = '/' } = await searchParams
  const t = await getTranslations('auth.signUp')
  const tAccount = await getTranslations('account')
  const locale = (await getLocale()) as Locale
  // Google OAuth signup and signin are the same Auth.js flow, so this is
  // the exact same action signin's Google button uses. A brand-new Google
  // account still reaches the guide first, same as the credentials path
  // below: Auth.js's own `pages.newUser` redirect (see src/auth.ts) sends a
  // first-time OAuth signin to `/guide` before `callbackUrl`, carrying that
  // destination as `?callbackUrl=` — `/guide` reads it as an alias for the
  // `?next=` the credentials `signUp` action uses.
  const googleAction = signInWithGoogle.bind(null, callbackUrl)
  return (
    <main className="flex flex-1 flex-col items-center justify-center gap-4 p-8">
      <h1 className="text-2xl font-bold">{t('title')}</h1>
      {/* Sign-up's language field. It changes the page you are reading, and
          the account created below inherits whatever it is left on. */}
      <LocaleToggle
        current={locale}
        labels={{ ko: tAccount('localeKo'), en: tAccount('localeEn') }}
      />
      <form action={googleAction}>
        <SubmitButton variant="outline" size="hero" className="w-72">
          {t('google')}
        </SubmitButton>
      </form>
      <CredentialsForm
        action={signUp}
        fields={['name', 'email', 'password']}
        labels={{ name: t('name'), email: t('email'), password: t('password') }}
        submitLabel={t('submit')}
        callbackUrl={callbackUrl}
      />
      <p className="text-sm text-muted-foreground">
        {t('haveAccount')}{' '}
        <Link
          className="underline"
          href={`/signin?callbackUrl=${encodeURIComponent(callbackUrl)}`}
        >
          {t('signInLink')}
        </Link>
      </p>
    </main>
  )
}
