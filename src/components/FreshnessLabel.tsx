'use client'

import { useRouter } from 'next/navigation'
import { useEffect, useState } from 'react'
import { formatRelativeTime } from '@/lib/format'
import { Button } from './ui/button'

/** "Updated Xm ago" + manual refresh. Re-renders every 30s; no polling. */
export function FreshnessLabel({
  renderedAt,
  updatedTemplate,
  refreshLabel,
}: {
  renderedAt: string
  updatedTemplate: string
  refreshLabel: string
}) {
  const router = useRouter()
  // Starts at "0m" (the page was just rendered) and ticks every 30s.
  const [now, setNow] = useState<Date | null>(null)
  useEffect(() => {
    const interval = setInterval(() => setNow(new Date()), 30_000)
    return () => clearInterval(interval)
  }, [])
  const ago = now ? formatRelativeTime(new Date(renderedAt), now) : '0m'
  return (
    <div className="flex items-center justify-between text-xs text-muted-foreground">
      <span data-testid="freshness">
        {updatedTemplate.replace('{ago}', ago)}
      </span>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        onClick={() => router.refresh()}
      >
        {refreshLabel}
      </Button>
    </div>
  )
}
