/**
 * HOLD_TOKENS — the "보류" (hold) family spec §5.1 names alongside YES/NO/
 * NEITHER. §2.6: `잠깐`/`잠깐만`/en `wait`/`hold on`/`hold up` are
 * **never** CONFIRM_NO_CANCEL — the open card stays untouched and the
 * reply only acknowledges (`assistant.guided.hold`). Kept as their own
 * family (not folded into NEGATE_TOKENS) precisely because folding them in
 * would recreate the ambiguity §2.6 exists to rule out.
 *
 * Sourced from spec §3.3's ko/en NEGATIVE rows (`{hold:true}`) plus §2.6's
 * ruling prose, §3.11's ko-only additions (`나중에`, `이따`), and §3.11's en
 * `we'll figure it out later`.
 */

import type { Freq, Locale } from './types'

export interface HoldTokenEntry {
  readonly token: string
  readonly locale: Locale
  readonly freq: Freq
}

export const HOLD_TOKENS = [
  { token: '잠깐', locale: 'ko', freq: '상' },
  { token: '잠깐만', locale: 'ko', freq: '상' },
  { token: '나중에', locale: 'ko', freq: '상' },
  { token: '이따', locale: 'ko', freq: '상' },
  { token: 'wait', locale: 'en', freq: '상' },
  { token: 'hold on', locale: 'en', freq: '상' },
  { token: 'hold up', locale: 'en', freq: '상' },
  { token: "we'll figure it out later", locale: 'en', freq: '하' },
] as const satisfies readonly HoldTokenEntry[]
