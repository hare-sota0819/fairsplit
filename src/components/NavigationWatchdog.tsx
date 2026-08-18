'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
// Internal import, deliberately (docs/SOLVED.md 2026-08-10): the wedge this
// watchdog exists for can hit navigations that never pass any public hook —
// a server action's redirect is performed as a seeded navigation INSIDE the
// server-action reducer, so `instrumentation-client`'s
// `onRouterTransitionStart` never fires for it (measured: link navigations
// record, action redirects do not). The router's applied state is the one
// place every navigation shape is visible. The module is a singleton within
// the app bundle, so this reads the same action queue the live router uses.
// If a Next upgrade moves this file, the BUILD fails loudly here — that is
// the desired failure mode, since the upgrade also needs this watchdog
// re-evaluated (a fixed React retires it).
import { getCurrentAppRouterState } from 'next/dist/client/components/app-router-instance'

const POLL_MS = 2000
/**
 * Consecutive mismatched polls before retrying — ≥3 polls means the applied
 * router URL and the browser's real location have disagreed for 4-6s.
 * Normal navigations hold that mismatch for MILLISECONDS (the router applies
 * its state only after the navigation's data has arrived, then React
 * commits, which is what moves `location`), so a sustained mismatch is not
 * "slow network" — the data is already on the client — it is a lost commit.
 * The e2e suite's 15s expect timeout leaves room for the recovery to land.
 */
const MISMATCH_POLLS_BEFORE_RETRY = 3

/**
 * Immunity against a lost navigation (docs/SOLVED.md 2026-08-10).
 *
 * This Next version's React can silently lose the Suspense retry "ping"
 * that resumes a suspended navigation transition: when the data the render
 * suspended on resolves in the window between React attaching the retry
 * listener and recording the suspension, the one-shot ping is consumed as
 * a no-op and nothing is ever scheduled again. The router's own state IS
 * applied (that part is plain JavaScript and always completes) and the
 * data has already arrived — only the React commit is lost: the old screen
 * stays, pending UI stays up forever, `location` never changes, and no
 * error fires anywhere. Measured at roughly 1 wedge per 100-250
 * navigations under e2e timing, on link navigations and server-action
 * redirects alike; ANY fresh router dispatch recovers instantly, because
 * everything is already cached.
 *
 * So, mounted once in the root layout: poll the router's applied
 * `canonicalUrl` against the browser's committed `location`. A sustained
 * disagreement is exactly a wedged commit — re-dispatch a navigation to
 * the applied URL, once per target. The same-URL dispatch re-renders from
 * the already-fulfilled cache and commits in milliseconds, and its commit
 * also performs the history update the wedged one never reached. A retry
 * that itself wedges (~p² of an already ~1% event) is left alone; that
 * residual, like the root cause, is documented in docs/SOLVED.md
 * 2026-08-10.
 */
export function NavigationWatchdog() {
  const router = useRouter()
  useEffect(() => {
    let mismatchPolls = 0
    let lastRetriedFor: string | null = null
    const tick = () => {
      const state = getCurrentAppRouterState()
      if (state === null) {
        return
      }
      let applied: URL
      try {
        applied = new URL(state.canonicalUrl, window.location.href)
      } catch {
        return
      }
      const appliedPath = applied.pathname + applied.search
      const committedPath = window.location.pathname + window.location.search
      if (appliedPath === committedPath) {
        mismatchPolls = 0
        lastRetriedFor = null
        return
      }
      mismatchPolls += 1
      if (
        mismatchPolls >= MISMATCH_POLLS_BEFORE_RETRY &&
        lastRetriedFor !== appliedPath
      ) {
        lastRetriedFor = appliedPath
        mismatchPolls = 0
        router.push(state.canonicalUrl)
      }
    }
    const interval = setInterval(tick, POLL_MS)
    return () => clearInterval(interval)
  }, [router])
  return null
}
