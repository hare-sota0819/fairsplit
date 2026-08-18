'use client'

import { useState } from 'react'
import { useTranslations } from 'next-intl'
import { createPortal } from 'react-dom'
import { nextTip } from './loaders/config'
import { RouteLoader, type LoaderId } from './loaders'

/**
 * The one loading overlay, used both while a link is pending and while a
 * server action is saving.
 *
 * IT DOES NOT BLANK THE SCREEN. It used to paint `bg-background/92` plus a
 * blur plus the page texture, which erased everything behind it — for a save
 * that lasts under a second, that reads as the app throwing your work away
 * and starting over. Now it is a scrim: the page stays faintly visible
 * underneath so you can see you are still where you were, and only the motif
 * and its caption are fully legible on top.
 *
 * PORTALLED TO <body> ON PURPOSE (Phase 4A). `position: fixed` resolves
 * against the nearest ancestor with a transform, filter or backdrop-filter,
 * and this used to render inside the element that triggered it — the bottom
 * bar carries effects, so a tab navigation anchored `inset-0` to a 56px strip
 * at the foot of the screen.
 */
export function LoadingOverlay({
  caption,
  id,
}: {
  /** What is loading. Kept for the accessible name; a tip is what is shown. */
  caption: string
  id?: LoaderId
}) {
  const t = useTranslations('loading')
  // A waiting second is a second you can use. The tip is drawn once per
  // overlay, so it does not shuffle under the reader's eyes.
  const [tip] = useState(nextTip)
  if (typeof document === 'undefined') {
    return null
  }
  return createPortal(
    <div className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-scrim">
      {/* Always the light-on-dark pair: the scrim darkens whatever theme is
          underneath, so the indicator must not follow the theme. */}
      <RouteLoader
        caption={t(`tips.${tip}`)}
        label={caption}
        id={id}
        onScrim
      />
    </div>,
    document.body,
  )
}
