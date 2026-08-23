'use client'

import { useEffect, useState } from 'react'

const EASE = 'cubic-bezier(.22,.61,.36,1)'

/**
 * The landing's hover/tap-reveal section nav (handoff SPEC.md §5).
 * Resting: four hairlines. Hover (fine pointers): rows reveal staggered
 * 42ms, blur 3px → 0. Touch: tap toggles, tap-anywhere closes.
 * Sits under the sticky app Header (top offset) at the reference's
 * fixed-left position.
 */
export function LandingNav({
  labels,
}: {
  labels: Record<'problem' | 'method' | 'rates' | 'principle' | 'product', string>
}) {
  const [open, setOpen] = useState(false)
  const [touch, setTouch] = useState(false)

  useEffect(() => {
    const mq = window.matchMedia('(hover: none), (pointer: coarse)')
    const apply = () => setTouch(mq.matches)
    apply()
    mq.addEventListener('change', apply)
    return () => mq.removeEventListener('change', apply)
  }, [])

  const rows = (
    ['problem', 'method', 'rates', 'principle', 'product'] as const
  ).map((id, i) => {
    const style: React.CSSProperties = open
      ? {
          opacity: 1,
          filter: 'blur(0)',
          transform: 'none',
          transition: `opacity .2s ${EASE} ${i * 42}ms, filter .24s ${EASE} ${i * 42}ms, transform .24s ${EASE} ${i * 42}ms`,
        }
      : {
          opacity: 0,
          filter: 'blur(3px)',
          transform: 'translateY(4px)',
          transition: 'opacity .09s ease, filter .09s ease, transform .09s ease',
          pointerEvents: 'none',
        }
    return (
      <a
        key={id}
        href={`#${id}`}
        onClick={() => setOpen(false)}
        style={style}
        className={`block text-[15px] leading-4 ${touch ? 'py-3' : 'py-1.5'} ${i === 0 ? 'text-[#6f6f6f]' : 'text-[#9a9a9a]'} hover:text-[#141414]`}
      >
        {labels[id]}
      </a>
    )
  })

  return (
    <>
      {touch && open ? (
        <button
          type="button"
          aria-label="close"
          onClick={() => setOpen(false)}
          className="fixed inset-0 z-20 cursor-default"
        />
      ) : null}
      <div
        onMouseEnter={touch ? undefined : () => setOpen(true)}
        onMouseLeave={touch ? undefined : () => setOpen(false)}
        onClick={touch ? () => setOpen((v) => !v) : undefined}
        className="fixed left-0 top-[calc(2.5rem+env(safe-area-inset-top))] z-20 hidden w-[clamp(96px,22vw,300px)] cursor-pointer pt-8 pb-14 pl-[clamp(22px,5vw,56px)] pr-10 sm:block"
      >
        <div
          aria-hidden="true"
          className="pointer-events-none absolute left-[clamp(22px,5vw,56px)] top-[38px] flex flex-col gap-[9px]"
          style={{
            opacity: open ? 0 : 1,
            transition: open ? 'opacity .1s ease' : 'opacity .16s ease .07s',
          }}
        >
          <span className="block h-px w-[17px] bg-[#b4b4b4]" />
          <span className="block h-px w-[17px] bg-[#b4b4b4]" />
          <span className="block h-px w-[17px] bg-[#b4b4b4]" />
          <span className="block h-px w-[12px] bg-[#b4b4b4]" />
        </div>
        <nav className="flex flex-col items-start">{rows}</nav>
      </div>
    </>
  )
}
