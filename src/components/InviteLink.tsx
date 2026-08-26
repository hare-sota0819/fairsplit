'use client'

import { useEffect, useRef, useState } from 'react'
import { cn } from '@/lib/utils'

/** How long "copied" is shown before the action offers itself again. */
const COPIED_HOLD_MS = 1800

/**
 * The invite row: the join URL sitting on a hairline with the copy action at
 * the far end. Copying swaps the ink-underlined link for the copied label —
 * grey, underline gone — for 1.8s; no toast, no icon, no color.
 */
export function InviteLink({
  inviteCode,
  copyLabel,
  copiedLabel,
}: {
  inviteCode: string
  copyLabel: string
  copiedLabel: string
}) {
  const [url, setUrl] = useState(`/join/${inviteCode}`)
  useEffect(() => {
    // The origin only exists in the browser, so the server renders the bare
    // path and the client fills the host in after mount — the same
    // browser-value-after-hydration case LandingDemo disables this for.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setUrl(`${window.location.origin}/join/${inviteCode}`)
  }, [inviteCode])

  const [copied, setCopied] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined)
  useEffect(() => () => clearTimeout(timer.current), [])
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url)
    } catch {
      // Clipboard can be denied; selecting the text below still works.
    }
    setCopied(true)
    clearTimeout(timer.current)
    timer.current = setTimeout(() => setCopied(false), COPIED_HOLD_MS)
  }
  const shown = url.replace(/^https?:\/\//, '')

  return (
    <div className="flex min-h-11 items-baseline gap-3 border-b border-border py-3">
      <span
        className="min-w-0 flex-1 truncate text-[14.5px] tabular-nums text-[#565656]"
        data-testid="invite-url"
        title={url}
      >
        {shown}
      </span>
      <button
        type="button"
        onClick={copy}
        data-testid="copy-invite"
        className={cn(
          'shrink-0 pb-px text-[13.5px] outline-none transition-colors duration-fast',
          copied
            ? 'text-[#8a8a8a]'
            : 'border-b border-foreground text-foreground hover:text-[#565656]',
        )}
      >
        {copied ? copiedLabel : copyLabel}
      </button>
    </div>
  )
}
