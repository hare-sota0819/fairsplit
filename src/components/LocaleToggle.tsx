'use client'

import { useTransition } from 'react'
import { setLocaleAction } from '@/i18n/actions'
import { LOCALES, type Locale } from '@/i18n/locale'

/**
 * A compact language switch for the signed-out screens.
 *
 * The account screen has the full list-row version; this one is a single line
 * of text, because on sign-up it sits under a form and must not compete with
 * it. It is also the "language field" of sign-up: choosing here writes the
 * cookie, the page comes back in that language, and `signUp` reads the same
 * cookie to stamp the account it creates. So the choice is made in the one
 * place where its effect is immediately visible.
 */
export function LocaleToggle({
  current,
  labels,
}: {
  current: Locale
  labels: Record<Locale, string>
}) {
  const [pending, startTransition] = useTransition()

  return (
    <p className="flex items-center gap-2 text-sm text-muted-foreground">
      {LOCALES.map((locale, index) => (
        <span key={locale} className="flex items-center gap-2">
          {index > 0 ? <span aria-hidden="true">·</span> : null}
          <button
            type="button"
            disabled={pending || locale === current}
            data-testid={`locale-toggle-${locale}`}
            onClick={() =>
              startTransition(async () => {
                await setLocaleAction(locale)
                window.location.reload()
              })
            }
            className={
              locale === current
                ? 'font-medium text-foreground'
                : 'underline transition-colors hover:text-foreground disabled:opacity-60'
            }
          >
            {labels[locale]}
          </button>
        </span>
      ))}
    </p>
  )
}
