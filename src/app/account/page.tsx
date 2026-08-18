import { redirect } from 'next/navigation'
import { getLocale, getTranslations } from 'next-intl/server'
import { ChevronRight } from 'lucide-react'
import { auth, signOut } from '@/auth'
import { BackLink } from '@/components/BackLink'
import { NavLink } from '@/components/NavLoader'
import { SubmitButton } from '@/components/SubmitButton'
import { ThemeChoice } from '@/components/ThemeChoice'
import { LanguageChoice } from './LanguageChoice'
import type { Locale } from '@/i18n/locale'

/**
 * The account screen, modelled directly on the reference's Account tab
 * (docs/DESIGN_SPEC.md §3.8): a screen title, a profile row with a 64px
 * avatar and the name over the email, then a sentence-case section header
 * and 56px list rows separated by full-bleed hairlines.
 *
 * Two things this screen exists to provide, neither of which the app had:
 * somewhere to see WHO you are signed in as, and a way to choose the theme.
 * Until now the app followed the OS with no way to override it.
 */
export default async function AccountPage() {
  const [session, locale, t, tNav, tLoading, tCommon] = await Promise.all([
    auth(),
    getLocale() as Promise<Locale>,
    getTranslations('account'),
    getTranslations('nav'),
    getTranslations('loading'),
    getTranslations('common'),
  ])
  if (!session?.user) {
    redirect('/signin?callbackUrl=/account')
  }

  const name = session.user.name?.trim() ?? ''
  const email = session.user.email ?? ''
  // The reference fills this slot with generated artwork. We have no avatar
  // pipeline, so it is the first character of the name — which is at least
  // yours, and never a stock face.
  const initial = (name || email || '?').slice(0, 1).toUpperCase()

  return (
    <main className="mx-auto flex w-full max-w-md flex-1 flex-col gap-6 px-5 py-6">
      {/* 4D-B: every screen below a tab root carries a back affordance.
          This one was added without it — the only way out was the browser. */}
      <BackLink
        href="/"
        caption={tLoading('general')}
        label={tCommon('back')}
        testId="back-link"
      />
      <h1 className="text-xl font-bold">{t('title')}</h1>

      <div className="flex items-center gap-4">
        <span
          aria-hidden="true"
          className="flex size-16 shrink-0 items-center justify-center rounded-full bg-primary-soft text-2xl font-bold text-primary"
        >
          {initial}
        </span>
        <span className="flex min-w-0 flex-col">
          <span className="truncate font-medium" data-testid="account-name">
            {name === '' ? t('noName') : name}
          </span>
          <span
            className="truncate text-sm text-muted-foreground"
            data-testid="account-email"
          >
            {email}
          </span>
        </span>
      </div>

      <section className="flex flex-col gap-2">
        <h2 className="text-xs font-bold">{t('appearance')}</h2>
        <ThemeChoice
          labels={{
            system: t('themeSystem'),
            light: t('themeLight'),
            dark: t('themeDark'),
          }}
        />
      </section>

      <section className="flex flex-col gap-2">
        <h2 className="text-xs font-bold">{t('language')}</h2>
        <LanguageChoice
          current={locale}
          labels={{ ko: t('localeKo'), en: t('localeEn') }}
        />
      </section>

      {/* No section header here: the row says what it is, and the
          reference only heads a GROUP of rows, never a single one. */}
      <section className="flex flex-col gap-2">
        <div className="-mx-5 border-b border-border">
          <NavLink
            href="/guide"
            caption={tLoading('general')}
            className="flex min-h-14 items-center justify-between gap-3 border-b border-border px-5 py-3 transition-[background-color,color,transform] duration-fast ease-swift hover:bg-muted active:scale-[0.97] active:bg-muted"
            testId="account-guide"
          >
            <span>{t('guide')}</span>
            <ChevronRight aria-hidden="true" className="size-4 text-chevron" />
          </NavLink>
          <NavLink
            href="/groups"
            caption={tLoading('general')}
            className="flex min-h-14 items-center justify-between gap-3 px-5 py-3 transition-[background-color,color,transform] duration-fast ease-swift hover:bg-muted active:scale-[0.97] active:bg-muted"
            testId="account-groups"
          >
            <span>{t('groups')}</span>
            <ChevronRight aria-hidden="true" className="size-4 text-chevron" />
          </NavLink>
        </div>
      </section>

      <section className="flex flex-col gap-2">
        <p className="text-sm text-muted-foreground">{t('signOutDesc')}</p>
        <form
          action={async () => {
            'use server'
            await signOut({ redirectTo: '/' })
          }}
        >
          <SubmitButton variant="outline" size="hero" testId="account-signout">
            {tNav('signOut')}
          </SubmitButton>
        </form>
      </section>
    </main>
  )
}
