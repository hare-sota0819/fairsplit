'use client'

import { useEffect } from 'react'

const EASE = 'cubic-bezier(.22,.61,.36,1)'

/**
 * Landing-only effects (handoff SPEC.md §6):
 * - 1px scroll-progress hairline pinned to the viewport top;
 * - [data-reveal] blur-in on first scroll into view (3px → 0, y10 → 0),
 *   per-element delay via data-reveal-delay; elements already above the
 *   fold reveal instantly; prefers-reduced-motion disables everything.
 * Renders one fixed div; the observer work happens in the effect.
 */
export function LandingReveal() {
  useEffect(() => {
    const bar = document.getElementById('landing-progress')
    const onScroll = () => {
      if (!bar) return
      const max = document.documentElement.scrollHeight - window.innerHeight
      bar.style.width =
        (max > 0 ? Math.min(100, (window.scrollY / max) * 100) : 0) + '%'
    }
    window.addEventListener('scroll', onScroll, { passive: true })
    onScroll()

    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    const els = Array.from(document.querySelectorAll<HTMLElement>('[data-reveal]'))
    let io: IntersectionObserver | undefined
    if (!reduced) {
      io = new IntersectionObserver(
        (entries) => {
          for (const e of entries) {
            const el = e.target as HTMLElement
            if (!e.isIntersecting && e.boundingClientRect.top > 0) continue
            const d = parseInt(el.dataset.revealDelay ?? '0', 10)
            el.style.transition = `opacity .55s ${EASE} ${d}ms, filter .65s ${EASE} ${d}ms, transform .65s ${EASE} ${d}ms`
            el.style.opacity = '1'
            el.style.filter = 'blur(0)'
            el.style.transform = 'none'
            io?.unobserve(el)
          }
        },
        { rootMargin: '0px 0px -10% 0px', threshold: 0.04 },
      )
      const vh = window.innerHeight
      for (const el of els) {
        if (el.getBoundingClientRect().top < vh * 0.92) continue
        el.style.opacity = '0'
        el.style.filter = 'blur(3px)'
        el.style.transform = 'translateY(10px)'
        io.observe(el)
      }
    }
    return () => {
      window.removeEventListener('scroll', onScroll)
      io?.disconnect()
    }
  }, [])

  return (
    <div className="pointer-events-none fixed inset-x-0 top-0 z-40 h-px">
      <div id="landing-progress" className="h-px w-0 bg-[#141414]" />
    </div>
  )
}
