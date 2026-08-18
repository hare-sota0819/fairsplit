import { requireUser } from '@/lib/membership'
import { utcDateString } from '@/lib/rates/cache-policy'
import { getSnapshotRate } from '@/lib/rates/cached'

/**
 * The market rate for the expense form's live preview. The form is a client
 * component and the currency can change while typing, so the cached provider
 * is reached through here rather than a page prop.
 *
 * Signed-in only — it is a proxy onto an outbound fetch, not public data.
 *
 * Returns the STORAGE form (settlement major per 1 foreign major) together
 * with the date the rate is actually FOR, and — when the source publishes
 * one — its exact timestamp. The date and today's date differ whenever the
 * live source is unreachable and the daily-fixing fallback answers, and the
 * form has to say so rather than call a three-day-old reference rate
 * "today's rate".
 */
export async function GET(request: Request): Promise<Response> {
  await requireUser()
  const url = new URL(request.url)
  const base = url.searchParams.get('base') ?? ''
  const quote = url.searchParams.get('quote') ?? ''
  const now = new Date()
  const today = utcDateString(now)
  if (!/^[A-Z]{3}$/.test(base) || !/^[A-Z]{3}$/.test(quote)) {
    return Response.json(
      { rate: null, asOf: null, asOfInstant: null, today },
      { status: 400 },
    )
  }
  if (base === quote) {
    // Not a looked-up rate at all, so it has no source timestamp.
    return Response.json({ rate: '1', asOf: today, asOfInstant: null, today })
  }
  const quoted = await getSnapshotRate(now, base, quote, now)
  return Response.json({
    rate: quoted?.rate ?? null,
    asOf: quoted?.asOf ?? null,
    asOfInstant: quoted?.asOfInstant ?? null,
    today,
  })
}
