'use client'

import { useState } from 'react'
import { Button } from './ui/button'

export function InviteLink({
  inviteCode,
  copyLabel,
  copiedLabel,
}: {
  inviteCode: string
  copyLabel: string
  copiedLabel: string
}) {
  const [copied, setCopied] = useState(false)
  const path = `/join/${inviteCode}`
  return (
    <div className="flex items-center gap-2 text-sm">
      <code
        data-testid="invite-link"
        className="min-w-0 flex-1 truncate rounded-lg bg-muted px-3 py-2 text-xs text-muted-foreground"
      >
        {path}
      </code>
      <Button
        type="button"
        variant="outline"
        size="touch"
        onClick={async () => {
          await navigator.clipboard.writeText(
            `${window.location.origin}${path}`,
          )
          setCopied(true)
        }}
      >
        {copied ? copiedLabel : copyLabel}
      </Button>
    </div>
  )
}
