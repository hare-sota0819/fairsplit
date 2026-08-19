'use client'

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import type { SemState } from './sem-state'

/**
 * Wires Sem's body to real app events (docs/BRAND.md v2 §4d). The chat
 * composer and transcript publish signals; the ONE `SemBody` on the page
 * reads the resolved state:
 *
 *   settled  (for ~2.6s after an expense is saved — morph in, hold, relax)
 *   speaking (for 350ms after a new Sem message starts rendering)
 *   thinking (parse / receipt scan / save / edit in flight, or the
 *             transcript's deliberate answer beat)
 *   listening (the composer holds unsent text)
 *   idle
 *
 * The two edge-triggered beats (speaking, settled) are held for their
 * duration here, since `SemBody` reacts to entering a state — so it sees a
 * clean idle → settled → idle transition even if the underlying event was
 * instantaneous.
 */

const SETTLED_HOLD_MS = 2600
const SPEAKING_HOLD_MS = 350

interface SemSignals {
  setTyping(typing: boolean): void
  setBusy(key: string, busy: boolean): void
  markSpeaking(): void
  markSettled(): void
}

const SignalsContext = createContext<SemSignals | null>(null)
const StateContext = createContext<SemState>('idle')

export function SemStateProvider({ children }: { children: React.ReactNode }) {
  const [typing, setTypingState] = useState(false)
  const [busyKeys, setBusyKeys] = useState<ReadonlySet<string>>(() => new Set())
  const [speaking, setSpeaking] = useState(false)
  const [settled, setSettled] = useState(false)
  const speakingTimer = useRef<number | null>(null)
  const settledTimer = useRef<number | null>(null)

  useEffect(
    () => () => {
      if (speakingTimer.current !== null) window.clearTimeout(speakingTimer.current)
      if (settledTimer.current !== null) window.clearTimeout(settledTimer.current)
    },
    [],
  )

  const signals = useMemo<SemSignals>(
    () => ({
      setTyping: (next) => setTypingState(next),
      setBusy: (key, busy) =>
        setBusyKeys((prev) => {
          if (prev.has(key) === busy) return prev
          const next = new Set(prev)
          if (busy) next.add(key)
          else next.delete(key)
          return next
        }),
      markSpeaking: () => {
        setSpeaking(true)
        if (speakingTimer.current !== null) window.clearTimeout(speakingTimer.current)
        speakingTimer.current = window.setTimeout(() => {
          speakingTimer.current = null
          setSpeaking(false)
        }, SPEAKING_HOLD_MS)
      },
      markSettled: () => {
        setSettled(true)
        if (settledTimer.current !== null) window.clearTimeout(settledTimer.current)
        settledTimer.current = window.setTimeout(() => {
          settledTimer.current = null
          setSettled(false)
        }, SETTLED_HOLD_MS)
      },
    }),
    [],
  )

  const state: SemState = settled
    ? 'settled'
    : speaking
      ? 'speaking'
      : busyKeys.size > 0
        ? 'thinking'
        : typing
          ? 'listening'
          : 'idle'

  return (
    <SignalsContext.Provider value={signals}>
      <StateContext.Provider value={state}>{children}</StateContext.Provider>
    </SignalsContext.Provider>
  )
}

const NOOP_SIGNALS: SemSignals = {
  setTyping: () => {},
  setBusy: () => {},
  markSpeaking: () => {},
  markSettled: () => {},
}

/** Publishers: safe to call outside a provider (no-ops there). */
export function useSemSignals(): SemSignals {
  return useContext(SignalsContext) ?? NOOP_SIGNALS
}

/** The resolved state for the page's one SemBody. */
export function useSemState(): SemState {
  return useContext(StateContext)
}

/** Publish a boolean "busy" flag under a key while it is true. */
export function useSemBusy(key: string, busy: boolean): void {
  const { setBusy } = useSemSignals()
  useEffect(() => {
    setBusy(key, busy)
    return () => setBusy(key, false)
  }, [key, busy, setBusy])
}

/** Publish whether the composer currently holds unsent text. */
export function useSemTyping(typing: boolean): void {
  const { setTyping } = useSemSignals()
  useEffect(() => {
    setTyping(typing)
    return () => setTyping(false)
  }, [typing, setTyping])
}

/** Fire the speaking pulse once, on mount, when `enabled`. */
export function useSemSpeakOnMount(enabled: boolean): void {
  const { markSpeaking } = useSemSignals()
  const fire = useCallback(() => {
    if (enabled) markSpeaking()
  }, [enabled, markSpeaking])
  useEffect(() => {
    fire()
    // Once per mounted message, on purpose.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
}
