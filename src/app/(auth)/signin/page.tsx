import Link from 'next/link'
import { getTranslations } from 'next-intl/server'
import { CredentialsForm } from '@/components/AuthForms'
import { SubmitButton } from '@/components/SubmitButton'
import { Wordmark } from '@/components/motion/Wordmark'

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
    <main className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center px-6 py-16">
      {/* SPEC-LOADERS §B — the identity mark on the login screen: three
          columns roll lookalike glyphs and land left→right on S · e · m,
          then stop. Played once per load and held. */}
      <Wordmark className="mb-8" />
      <h1 className="font-heading text-[32px] leading-[1.25] font-normal tracking-[-0.01em] text-foreground">
        {t('title')}
      </h1>
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
          action={signInWithPassword}
          fields={['email', 'password']}
          labels={{ email: t('email'), password: t('password') }}
          submitLabel={t('submit')}
          callbackUrl={callbackUrl}
        />
      </div>
      <p className="mt-12 text-sm text-muted-foreground">
        {t('noAccount')}{' '}
        <Link
          className="text-foreground underline decoration-1 underline-offset-4 hover:text-muted-foreground"
          href={`/signup?callbackUrl=${encodeURIComponent(callbackUrl)}`}
        >
          {t('signUpLink')}
        </Link>{' '}
        ·{' '}
        <Link
          className="text-foreground underline decoration-1 underline-offset-4 hover:text-muted-foreground"
          href="/reset-password"
        >
          {t('forgot')}
        </Link>
      </p>
    </main>
  )
}
