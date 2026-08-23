'use client'

import { useEffect, useRef, useState } from 'react'
import type { Locale } from '@/i18n/locale'

/**
 * The landing's interactive split (reference §"Try a split").
 * Mirrors the settlement engine's rules for DISPLAY only:
 *   total = round(minor × rate × minorUnit)
 *   per   = ceil(total / n)          (participants round up)
 *   payer = total − per × (n − 1)    (remainder favors the payer)
 * Home currency follows the app locale (en → USD, ko → KRW) — the same
 * default rule group creation uses.
 */
const JPY = 11875
const CFG: Record<Locale, { rates: { avg: number; market: number }; minor: number }> = {
  en: { rates: { avg: 0.0068, market: 0.00704 }, minor: 100 },
  ko: { rates: { avg: 9.13, market: 9.41 }, minor: 1 },
}

function fmt(locale: Locale, minor: number): string {
  return locale === 'en'
    ? '$' + (minor / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
    : minor.toLocaleString('ko-KR') + '원'
}

type Labels = {
  item: string
  paidBy: string
  peopleL: string
  rateL: string
  payer: string
  paidTag: string
  names: string[]
  rateAvg: string
  rateMkt: string
  totalL: string
  perL: string
  owedL: string
  soloNote: string
  evenNote: string
  remNoteBefore: string
  remNoteAfter: string
  personOne: string
  personMany: string
}

export function LandingDemo({ locale, labels }: { locale: Locale; labels: Labels }) {
  const [sel, setSel] = useState([true, true, true])
  const [mode, setMode] = useState<'avg' | 'market'>('avg')
  const cfg = CFG[locale]

  const total = Math.round(JPY * cfg.rates[mode] * cfg.minor)
  const n = 1 + sel.filter(Boolean).length
  const per = Math.ceil(total / n)
  const payer = total - per * (n - 1)
  const owed = total - payer
  const rem = per - payer

  const disp = useRolled({ total, per, owed, payer })

  const chip = (on: boolean) =>
    `inline-block border-b pb-[3px] transition-colors duration-fast ${on ? 'border-[#141414] text-[#141414]' : 'border-transparent text-[#b8b8b8]'}`
  const hit = 'bg-transparent border-0 -m-2.5 p-2.5 cursor-pointer text-[17px] font-[inherit]'

  return (
    <div data-reveal data-reveal-delay="140" className="mt-12 max-w-[640px]">
      <div className="flex items-baseline justify-between border-b border-[#141414] pb-4">
        <span className="font-heading text-[23px] text-[#141414]">{labels.item}</span>
        <span className="font-heading text-[23px] text-[#141414] tabular-nums">&yen;11,875</span>
      </div>
      <p className="mt-3 text-[14px] text-[#9a9a9a]">{labels.paidBy}</p>

      <p className="mt-9 text-[12px] uppercase tracking-[0.12em] text-[#a8a8a8]">
        {labels.peopleL}
      </p>
      <div className="mt-3.5 flex flex-wrap items-baseline gap-x-10 gap-y-3">
        <span className="border-b border-[#141414] pb-[3px] text-[17px] text-[#141414]">
          {labels.payer}
          <span className="ml-1.5 text-[12px] text-[#9a9a9a]">{labels.paidTag}</span>
        </span>
        {labels.names.map((name, i) => (
          <button
            key={name}
            type="button"
            className={hit}
            onClick={() => setSel((s) => s.map((v, j) => (i === j ? !v : v)))}
          >
            <span className={chip(sel[i])}>{name}</span>
          </button>
        ))}
      </div>

      <p className="mt-9 text-[12px] uppercase tracking-[0.12em] text-[#a8a8a8]">
        {labels.rateL}
      </p>
      <div className="mt-3.5 flex flex-wrap items-baseline gap-x-10 gap-y-3">
        <button type="button" className={hit} onClick={() => setMode('avg')}>
          <span className={chip(mode === 'avg')}>
            {labels.rateAvg} <span className="tabular-nums">{cfg.rates.avg}</span>
          </span>
        </button>
        <button type="button" className={hit} onClick={() => setMode('market')}>
          <span className={chip(mode === 'market')}>
            {labels.rateMkt} <span className="tabular-nums">{cfg.rates.market}</span>
          </span>
        </button>
      </div>

      <div className="mt-12 flex flex-col tabular-nums">
        <Row label={labels.totalL} value={fmt(locale, disp.total)} />
        <Row
          label={
            <>
              {labels.perL}{' '}
              <span className="text-[#b8b8b8]">
                {n === 1 ? labels.personOne : `${n} ${labels.personMany}`}
              </span>
            </>
          }
          value={fmt(locale, disp.per)}
        />
        <div className="mt-0.5 h-px bg-[#141414]" />
        <div className="mt-0.5 h-px bg-[#141414]" />
        <p className="flex items-baseline py-3.5">
          <span className="text-[15px] text-[#8a8a8a]">{labels.owedL}</span>
          <span className="flex-1" />
          <span className="font-heading text-[23px] text-[#141414]">
            {fmt(locale, disp.owed)}
          </span>
        </p>
      </div>
      <p className="text-[14px] leading-[1.6] text-[#9a9a9a] tabular-nums">
        {n === 1
          ? labels.soloNote
          : rem === 0
            ? labels.evenNote
            : `${labels.remNoteBefore}${fmt(locale, disp.payer)}${labels.remNoteAfter}`}
      </p>
    </div>
  )
}

function Row({ label, value }: { label: React.ReactNode; value: string }) {
  return (
    <p className="flex items-baseline border-t border-[#e4e4e4] py-3.5">
      <span className="text-[15px] text-[#8a8a8a]">{label}</span>
      <span
        aria-hidden="true"
        className="mx-3 min-w-4 flex-1 -translate-y-[3px] border-b border-dotted border-[#d8d8d8]"
      />
      <span className="font-heading text-[20px] text-[#141414]">{value}</span>
    </p>
  )
}

/** 400ms cubic ease-out roll toward each new target (SPEC.md §6). */
function useRolled(target: { total: number; per: number; owed: number; payer: number }) {
  const [disp, setDisp] = useState(target)
  const raf = useRef(0)
  const from = useRef(target)
  const key = `${target.total}:${target.per}:${target.owed}:${target.payer}`
  useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setDisp(target)
      return
    }
    const start = from.current
    const t0 = performance.now()
    cancelAnimationFrame(raf.current)
    const step = (now: number) => {
      const k = Math.min(1, (now - t0) / 400)
      const e = 1 - Math.pow(1 - k, 3)
      const next = {
        total: Math.round(start.total + (target.total - start.total) * e),
        per: Math.round(start.per + (target.per - start.per) * e),
        owed: Math.round(start.owed + (target.owed - start.owed) * e),
        payer: Math.round(start.payer + (target.payer - start.payer) * e),
      }
      setDisp(next)
      from.current = next
      if (k < 1) raf.current = requestAnimationFrame(step)
    }
    raf.current = requestAnimationFrame(step)
    return () => cancelAnimationFrame(raf.current)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])
  return disp
}
