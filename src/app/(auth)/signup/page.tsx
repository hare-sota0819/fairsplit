import Link from 'next/link'
import { getLocale, getTranslations } from 'next-intl/server'
import { CredentialsForm } from '@/components/AuthForms'
import { LocaleToggle } from '@/components/LocaleToggle'
import { SubmitButton } from '@/components/SubmitButton'
import { Wordmark } from '@/components/motion/Wordmark'
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
  // Google OAuth signup and signin are the same Auth.js flow; a brand-new
  // Google account still reaches the guide first (pages.newUser redirect in
  // src/auth.ts) carrying the destination as ?callbackUrl=.
  const googleAction = signInWithGoogle.bind(null, callbackUrl)
  return (
    <main className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center px-6 py-16">
      {/* SPEC-LOADERS §B — the identity mark on the login screen: three
          columns roll lookalike glyphs and land left→right on S · e · m,
          then stop. Played once per load and held. */}
      <Wordmark className="mb-8" />
      <h1 className="font-heading text-[32px] leading-[1.25] font-normal tracking-[-0.01em] text-foreground">
        {t('title')}
      </h1>
      {/* Sign-up's language field: it changes the page you are reading, and
          the account created below inherits whatever it is left on. */}
      <div className="mt-2.5">
        <LocaleToggle
          current={locale}
          labels={{ ko: tAccount('localeKo'), en: tAccount('localeEn') }}
        />
      </div>
      <form action={googleAction} className="mt-10">
        <SubmitButton
          variant="statement"
          size="text"
          className="w-full justify-between border-t border-b border-t-foreground border-b-border py-4 text-[15.5px] no-underline"
        >
          {t('google')}
          <span aria-hidden="true" className="text-muted-foreground">
            &rarr;
          </span>
        </SubmitButton>
      </form>
      <div className="mt-9">
        <CredentialsForm
          action={signUp}
          fields={['name', 'email', 'password']}
          labels={{
            name: t('name'),
            email: t('email'),
            password: t('password'),
          }}
          submitLabel={t('submit')}
          callbackUrl={callbackUrl}
        />
      </div>
      <p className="mt-12 text-sm text-muted-foreground">
        {t('haveAccount')}{' '}
        <Link
          className="text-foreground underline decoration-1 underline-offset-4 hover:text-muted-foreground"
          href={`/signin?callbackUrl=${encodeURIComponent(callbackUrl)}`}
        >
          {t('signInLink')}
        </Link>
      </p>
    </main>
  )
}
