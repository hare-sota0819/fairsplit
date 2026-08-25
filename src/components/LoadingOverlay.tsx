'use client'

import { useTranslations } from 'next-intl'
import { createPortal } from 'react-dom'
import { RouteLoader, type LoaderId } from './loaders'

/**
 * The one loading overlay, for route transitions and cold starts.
 *
 * IT SITS ON PAPER (FIXES §1). The dark scrim is gone: a wait is not a
 * modal, and dimming the page to write a ledger on top of it made a
 * half-second navigation read as the app leaving. The overlay now paints
 * the page's own background and draws the motif in ink, exactly as the
 * loader reference does.
 *
 * SAVES DO NOT USE IT AT ALL. The commit button's own three acts are the
 * only feedback a server action gets (SPEC-INTERACTIONS §3/§4).
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
  /** What is loading. The accessible name; the visible line is fixed. */
  caption: string
  id?: LoaderId
}) {
  const t = useTranslations('loading')
  if (typeof document === 'undefined') {
    return null
  }
  return createPortal(
    <div className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-background">
      <RouteLoader caption={t('general')} label={caption} id={id} />
    </div>,
    document.body,
  )
}
