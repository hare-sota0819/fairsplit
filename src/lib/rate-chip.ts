import type { RateSource } from '@/lib/settlement'

/** A next-intl translator scoped to the `rateChip` namespace. */
export type ChipTranslator = (
  key: string,
  values?: Record<string, string | number>,
) => string

export interface ChipResolution {
  source: RateSource
  /** The wallet the rate came from, when one did. */
  walletLabel?: string
  /** A checkpoint pinned this conversion. */
  frozen?: boolean
}

export interface RateChipCopy {
  label: string
  explanation: string
}

/**
 * What the rate-source chip says, in one place.
 *
 * A frozen conversion carries TWO facts and the chip has to deliver both: the
 * number cannot move any more, and it was produced by a particular rate. The
 * label takes the first (it is what the reader needs at a glance) and the
 * explanation names the second, so the record of which rate settled the money
 * is never lost to a display decision.
 *
 * Pure so both callers — the feed rows and the expense detail — can be held to
 * the same copy by a test rather than by prose.
 */
export function rateChipCopy(
  resolution: ChipResolution,
  t: ChipTranslator,
): RateChipCopy {
  // Name the wallet only when its own rate was actually used. A fallback
  // carries the label too, but calling a market rate "Cash rate" would lie.
  const appliedLabel =
    resolution.source === 'WALLET_AVG_COST' && resolution.walletLabel
      ? t('withLabel', { label: resolution.walletLabel })
      : t(resolution.source)

  if (resolution.frozen !== true) {
    return {
      label: appliedLabel,
      explanation: t(`explain.${resolution.source}`),
    }
  }
  return {
    label: t('FROZEN'),
    explanation: `${t('explain.FROZEN')} ${t('frozenOriginal', {
      source: appliedLabel,
    })}`,
  }
}
