'use client'

import { useState } from 'react'
import { useTranslations } from 'next-intl'
import { SemBodyLazy } from '@/components/sem/SemBodyLazy'
import { SEM_STATES, type SemState } from '@/components/sem/sem-state'

const SIZES = [48, 160, 300] as const

/**
 * The viewing room for Sem's body (docs/BRAND.md v2 §4): one instance,
 * a state switch and a size switch. Tuning happens in SemBody's CAL table;
 * this page only exists to watch it for ten seconds and ask whether it is
 * alive or a spin animation.
 */
export function SemLab() {
  const t = useTranslations('dev.sem')
  const [state, setState] = useState<SemState>('idle')
  const [size, setSize] = useState<(typeof SIZES)[number]>(160)
  const [pokes, setPokes] = useState(0)

  const chip = (active: boolean) =>
    `h-9 px-3 text-sm transition-colors duration-fast ${
      active ? 'text-foreground' : 'text-muted-foreground hover:text-foreground'
    }`

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col items-center gap-10 px-6 py-10">
      <h1 className="text-xl font-bold">{t('title')}</h1>

      <div
        className="flex h-[300px] w-[300px] items-center justify-center"
        data-testid="sem-lab-stage"
      >
        <SemBodyLazy state={state} size={size} onPoke={() => setPokes((n) => n + 1)} />
      </div>

      <section className="flex flex-col items-center gap-2">
        <p className="text-xs font-semibold text-muted-foreground">
          {t('stateLabel')}
        </p>
        <div className="flex flex-wrap justify-center gap-1">
          {SEM_STATES.map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => setState(s)}
              className={chip(s === state)}
              data-testid={`sem-lab-state-${s}`}
            >
              {t(`states.${s}`)}
            </button>
          ))}
        </div>
      </section>

      <section className="flex flex-col items-center gap-2">
        <p className="text-xs font-semibold text-muted-foreground">
          {t('sizesLabel')}
        </p>
        <div className="flex gap-1">
          {SIZES.map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => setSize(s)}
              className={chip(s === size)}
              data-testid={`sem-lab-size-${s}`}
            >
              {s}px
            </button>
          ))}
        </div>
      </section>

      <p className="text-xs text-muted-foreground" data-testid="sem-lab-pokes">
        {t('pokes', { count: pokes })}
      </p>
    </main>
  )
}
