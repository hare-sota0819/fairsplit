/**
 * HELP_MARKERS — the GENERALIZING trigger vocabulary for HELP, not §3.10's
 * attested sentences (those are fixture-shaped test rows for T3/T4 and live
 * verbatim in `corpus.ts`'s `HELP_CORPUS`).
 *
 * Spec §2 gives no AND-group decomposition for HELP the way §2.5 does for
 * QUERY (P4 is just "a help trigger matches") — so unlike modify.ts/
 * query.ts, there is no formal algorithm to extract from §2 prose. What
 * follows is the reviewer's named marker set (도움말/명령어/사용법/기능/
 * 매뉴얼/help/"what can you do"-frames) plus the smallest common substring
 * shared across §3.10's redundant ko surface variants — a real
 * generalization (not fuzzy/stem matching: every substring here is an exact
 * prefix genuinely shared by the attested rows it covers), e.g. `할 수 있`
 * covers both `뭐 할 수 있어?` and `뭐 할 수 있는지 알려줘`. English rows
 * are already minimal (no further decomposition improves generality without
 * becoming dangerously generic, e.g. shortening "how do I use this" loses
 * the whole meaning), so the en main table is kept intact as marker rows —
 * each one independently triggers HELP, there being no §2 AND-group to
 * build for this intent. `어떻게` alone is deliberately excluded: it just
 * means "how" and would false-positive on unrelated questions; the ko rows
 * that only share that word (`정산 어떻게 확인해요?`, `어떻게 쓰는 거야?`,
 * `어떻게 써?`) stay in `corpus.ts` only, for T4 to handle with a fuller
 * pattern.
 */

import type { Freq, Locale, Tier } from './types'

export interface HelpMarkerEntry {
  readonly marker: string
  readonly locale: Locale
  readonly tier: Tier
  readonly freq: Freq
}

export const HELP_MARKERS = [
  // ko nouns
  { marker: '도움말', locale: 'ko', tier: 'main', freq: '상' },
  { marker: '/도움말', locale: 'ko', tier: 'main', freq: '중' },
  { marker: '명령어', locale: 'ko', tier: 'main', freq: '중' },
  { marker: '사용법', locale: 'ko', tier: 'main', freq: '중' },
  { marker: '사용 방법', locale: 'ko', tier: 'exp', freq: '하' },
  { marker: '기능', locale: 'ko', tier: 'exp', freq: '하' },
  { marker: '매뉴얼', locale: 'ko', tier: 'exp', freq: '하' },
  { marker: 'help', locale: 'ko', tier: 'exp', freq: '하' },
  // ko "what can you do" frame — shared prefix across 뭐/뭘 할 수 있어(?)/
  // 있는지 알려줘 (drops the 뭐/뭘/넌 subject prefix, an even broader
  // generalization the substring matcher already covers for free)
  { marker: '할 수 있', locale: 'ko', tier: 'main', freq: '상' },
  { marker: '뭐 물어보면 돼', locale: 'ko', tier: 'exp', freq: '하' },
  // T4 addition — the `어떻게` cluster T2's own header explicitly deferred
  // ("stay in corpus.ts only, for T4 to handle with a fuller pattern"):
  // `어떻게` alone is still excluded (too generic), but paired with the
  // verb that follows it, each frame is a real, non-generic HELP signal.
  // `어떻게 확인` covers `정산 어떻게 확인해요?`; `어떻게 쓰는` covers `이거
  // 어떻게 쓰는 거야`/`어떻게 쓰는 거야?`; `어떻게 써` (a distinct
  // substring, not a superset of `어떻게 쓰는`) covers `어떻게 써?`.
  // Collision-checked against the D-7 decoy `정산 어떻게 진행되고 있어?`
  // (DECOY_PHRASES' `진행` marker, checked before HELP in the ladder
  // anyway) — none of these three frames appear inside it.
  { marker: '어떻게 확인', locale: 'ko', tier: 'main', freq: '상' },
  { marker: '어떻게 쓰는', locale: 'ko', tier: 'main', freq: '중' },
  { marker: '어떻게 써', locale: 'ko', tier: 'main', freq: '중' },

  // en — kept as full minimal frames (no §2 AND-group to decompose against)
  { marker: 'help', locale: 'en', tier: 'main', freq: '상' },
  { marker: 'help me', locale: 'en', tier: 'main', freq: '상' },
  { marker: 'what can you do', locale: 'en', tier: 'main', freq: '중' },
  { marker: 'what do you do', locale: 'en', tier: 'main', freq: '중' },
  { marker: 'how do I use this', locale: 'en', tier: 'main', freq: '중' },
  { marker: 'how does this work', locale: 'en', tier: 'main', freq: '중' },
  {
    marker: 'what commands do you have',
    locale: 'en',
    tier: 'main',
    freq: '하',
  },
  { marker: 'what can I ask you', locale: 'en', tier: 'main', freq: '하' },
] as const satisfies readonly HelpMarkerEntry[]
