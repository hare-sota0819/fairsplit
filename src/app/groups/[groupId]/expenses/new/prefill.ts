import { CURATED_CURRENCIES } from '@/lib/currencies'
import { parseAmountToMinor } from '@/lib/format'
import type { ExpensePrefill } from '../form-props'

function isCuratedCurrency(
  code: string,
): code is (typeof CURATED_CURRENCIES)[number] {
  return (CURATED_CURRENCIES as readonly string[]).includes(code)
}

/**
 * One query-string value. Next.js hands back `string[]` for a repeated key
 * (`?draftAmount=1&draftAmount=2`) — this app's own links never repeat a
 * key, so any array is treated the same as "absent" rather than being fed
 * to `parseAmountToMinor`, which expects a string and would throw on one.
 */
export type SearchParamValue = string | string[] | undefined

function stringParam(value: SearchParamValue): string | undefined {
  return typeof value === 'string' ? value : undefined
}

/**
 * Resolves the chat composer's handoff query params (`?draftAmount=&
 * draftNote=&draftCurrency=`, see `ChatComposer.tsx`'s `draftFormHref`) into
 * the wizard's prefill. Pure — no Next.js types, no I/O — so the validation
 * rules have one tested source of truth.
 *
 * Returns `undefined` when there was no handoff at all (`draftAmount`
 * missing or repeated), so `new/page.tsx` can tell "no handoff" apart from
 * "handoff with an unusable amount."
 *
 * `draftAmount` is the ONLY field gated on validity: it must parse to a real
 * minor-unit amount under the resolved currency
 * (`parseAmountToMinor(draftAmount, currency) !== null`), or `amount` alone
 * is dropped from the result — not the whole prefill. Currency and note are
 * independently well-formed strings; dropping them too on an amount failure
 * (e.g. `1200.5엔`, which JPY rejects for having decimals) would land the
 * user on a blank wizard even though two thirds of what they typed was
 * fine — the exact dead end this task exists to remove.
 *
 * `draftCurrency` is validated against `CURATED_CURRENCIES` — the same list
 * the currency picker itself offers — and falls back to the group's
 * settlement currency when unrecognized, rather than being dropped.
 */
export function resolvePrefill(
  settlementCurrency: string,
  searchParams: {
    draftAmount?: SearchParamValue
    draftNote?: SearchParamValue
    draftCurrency?: SearchParamValue
  },
): ExpensePrefill | undefined {
  const draftAmount = stringParam(searchParams.draftAmount)
  if (draftAmount === undefined) {
    return undefined
  }
  const draftCurrency = stringParam(searchParams.draftCurrency)
  const currency =
    draftCurrency !== undefined && isCuratedCurrency(draftCurrency)
      ? draftCurrency
      : settlementCurrency
  const amount =
    parseAmountToMinor(draftAmount, currency) !== null ? draftAmount : undefined
  return {
    ...(amount !== undefined ? { amount } : {}),
    currency,
    note: stringParam(searchParams.draftNote) ?? '',
  }
}
