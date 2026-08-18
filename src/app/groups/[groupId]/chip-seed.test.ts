/**
 * Review I5's regression net: `chat.chipSeed.*` (`src/messages/{en,ko}.json`)
 * holds the literal sentences `ChatComposer`'s GUIDED suggestion chips
 * inject and resubmit through `classify()` — see `CHIP_SEED_KEY` and
 * `pushGuidedAnswer` in `ChatComposer.tsx`. If a future copy edit to one of
 * these keys drifts away from the intent it is supposed to trigger (e.g. the
 * ko `myBalance` seed stops reading as a P3 query and falls through to
 * EXPENSE_ENTRY or UNKNOWN), the chip would silently stop doing what its own
 * prompt promises — "Want to know what you owe?" followed by a tap that
 * answers something else entirely, or nothing. Drives every seed through the
 * REAL messages JSON via `next-intl`'s `createTranslator` (same tool
 * `compose.test.ts`'s ICU render-smoke suite uses), not a hand-copied string,
 * so this can't drift from the shipped copy.
 */

import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createTranslator } from 'next-intl'
import { describe, expect, it } from 'vitest'
import { classify } from '@/lib/assistant/classify'
import type { AssistantContext, Intent } from '@/lib/assistant/types'

const DIR = dirname(fileURLToPath(import.meta.url))
const enMessages = JSON.parse(
  readFileSync(join(DIR, '../../../messages/en.json'), 'utf8'),
)
const koMessages = JSON.parse(
  readFileSync(join(DIR, '../../../messages/ko.json'), 'utf8'),
)

const tEn = createTranslator({ locale: 'en', messages: enMessages })
const tKo = createTranslator({ locale: 'ko', messages: koMessages })

const KO_CTX: AssistantContext = {
  members: [
    { id: 'm1', name: '민수' },
    { id: 'm2', name: '유나' },
    { id: 'm3', name: '철수' },
  ],
  actorId: 'me',
  defaultCurrency: 'KRW',
  locale: 'ko',
  openCard: null,
}
const EN_CTX: AssistantContext = {
  members: [
    { id: 'm1', name: 'Sam' },
    { id: 'm2', name: 'Jo' },
    { id: 'm3', name: 'Alex' },
  ],
  actorId: 'me',
  defaultCurrency: 'USD',
  locale: 'en',
  openCard: null,
}

// Mirrors ChatComposer.tsx's own `CHIP_SEED_KEY` table — the five intents
// that seed from a plain, no-argument `chat.chipSeed.<key>` string.
const SIMPLE_SEEDS: Array<{ intent: Intent; key: string }> = [
  { intent: 'QUERY_MY_BALANCE', key: 'myBalance' },
  { intent: 'QUERY_GROUP_TOTAL', key: 'groupTotal' },
  { intent: 'QUERY_MY_SPENDING', key: 'mySpending' },
  { intent: 'QUERY_WALLET', key: 'wallet' },
  { intent: 'HELP', key: 'help' },
]

describe('chat.chipSeed — every seed classifies to the intent its chip promises', () => {
  describe.each([
    { locale: 'ko' as const, t: tKo, ctx: KO_CTX },
    { locale: 'en' as const, t: tEn, ctx: EN_CTX },
  ])('$locale', ({ t, ctx }) => {
    it.each(SIMPLE_SEEDS)('$intent (chipSeed.$key)', ({ intent, key }) => {
      const seed = t(`chat.chipSeed.${key}` as Parameters<typeof t>[0])
      expect(classify(seed, ctx).intent).toBe(intent)
    })

    it('QUERY_PAIRWISE (chipSeed.pairwise, bound to a real member)', () => {
      const name = ctx.members[0].name
      const seed = t('chat.chipSeed.pairwise', { name })
      const result = classify(seed, ctx)
      expect(result.intent).toBe('QUERY_PAIRWISE')
      expect(result.intent === 'QUERY_PAIRWISE' && result.memberId).toBe(
        ctx.members[0].id,
      )
    })
  })
})
