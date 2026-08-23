'use client'

import { Check } from 'lucide-react'
import { useTransition } from 'react'
import { setLocaleAction } from '@/i18n/actions'
import { LOCALES, type Locale } from '@/i18n/locale'

/**
 * The language control, built to look exactly like the theme rows above it.
 *
 * Unlike the theme, this cannot live in localStorage: the messages are chosen
 * on the SERVER, before any of this code runs, so the choice has to reach the
 * server before the next render. It writes a cookie (and the account row) and
 * then reloads.
 *
 * The reload is deliberate and is not `router.refresh()`. Refresh does not
 * reliably re-render the route it was called from in this Next version — the
 * project has been bitten by that three times (docs/SOLVED.md 2026-08-03) —
 * and a language switch that half-applies is worse than a blink.
 */
export function LanguageChoice({
  current,
  labels,
}: {
  current: Locale
  labels: Record<Locale, string>
}) {
  const [pending, startTransition] = useTransition()

  function choose(next: Locale) {
    if (next === current || pending) {
      return
    }
    startTransition(async () => {
      await setLocaleAction(next)
      window.location.reload()
    })
  }

  return (
    <ul className="-mx-5 divide-y divide-border border-y border-border">
      {LOCALES.map((locale) => (
        <li key={locale}>
          <button
            type="button"
            role="radio"
            aria-checked={current === locale}
            disabled={pending}
            onClick={() => choose(locale)}
            data-testid={`locale-${locale}`}
            className="flex min-h-14 w-full items-center justify-between gap-3 px-5 py-3 text-left transition-[background-color,color,transform] duration-fast ease-swift hover:bg-muted active:translate-y-px active:bg-muted disabled:opacity-60"
          >
            <span>{labels[locale]}</span>
            {current === locale ? (
              <Check aria-hidden="true" className="size-5 text-primary" />
            ) : null}
          </button>
        </li>
      ))}
    </ul>
  )
}
