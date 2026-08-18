'use client'

import { useState } from 'react'
import { useTranslations } from 'next-intl'
import { SemMark } from '@/components/sem/SemMark'
import { SEM_STATES, type SemState } from '@/lib/sem/engine'

export function SemLab() {
  const t = useTranslations('dev.sem')
  const [state, setState] = useState<SemState>('idle')
  const [members, setMembers] = useState(3)
  const [accentOn, setAccentOn] = useState(true)

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col items-center gap-8 px-6 py-10">
      <h1 className="text-xl font-bold tracking-[-0.02em]">{t('title')}</h1>

      <div className="flex h-[300px] w-[300px] items-center justify-center">
        <SemMark key={`${members}-${accentOn}`} state={state} members={members} size={300} accentOn={accentOn} interactive />
      </div>

      <section className="flex flex-col items-center gap-2">
        <p className="text-xs font-semibold text-muted-foreground">
          {t('stateLabel')}
        </p>
        <div className="flex flex-wrap justify-center gap-2">
          {SEM_STATES.map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => setState(s)}
              className={`h-11 rounded-full px-4 text-sm font-semibold transition-colors ${
                s === state
                  ? 'bg-primary text-primary-foreground'
                  : 'bg-primary-soft text-foreground'
              }`}
            >
              {t(`states.${s}`)}
            </button>
          ))}
        </div>
      </section>

      <section className="flex items-center gap-6">
        <label className="flex items-center gap-2 text-sm font-medium">
          {t('membersLabel')}
          <input
            type="range"
            min={2}
            max={5}
            value={members}
            onChange={(e) => setMembers(Number(e.target.value))}
          />
          <span className="tabular-nums">{members}</span>
        </label>
        <label className="flex items-center gap-2 text-sm font-medium">
          <input
            type="checkbox"
            checked={accentOn}
            onChange={(e) => setAccentOn(e.target.checked)}
          />
          {t('accentLabel')}
        </label>
      </section>

      <section className="flex flex-col items-center gap-3">
        <p className="text-xs font-semibold text-muted-foreground">
          {t('sizesLabel')}
        </p>
        <div className="flex items-end gap-6">
          <SemMark state={state} members={members} size={28} accentOn={accentOn} />
          <SemMark state={state} members={members} size={44} accentOn={accentOn} />
          <SemMark state={state} members={members} size={88} accentOn={accentOn} />
        </div>
      </section>

      <section className="flex flex-col items-center gap-3">
        <p className="text-xs font-semibold text-muted-foreground">
          {t('frozenLabel')}
        </p>
        <div className="flex items-end gap-6">
          <SemMark state="settled" members={members} size={44} live={false} accentOn={accentOn} />
          <SemMark state="settled" members={members} size={88} live={false} accentOn={accentOn} />
        </div>
      </section>
    </main>
  )
}
