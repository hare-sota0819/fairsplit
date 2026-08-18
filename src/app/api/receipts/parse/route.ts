import { auth } from '@/auth'
import { prisma } from '@/lib/prisma'
import {
  RECEIPT_DAILY_SCAN_LIMIT,
  RECEIPT_MAX_UPLOAD_BYTES,
} from '@/lib/receipts/config'
import { GeminiReceiptParser } from '@/lib/receipts/gemini'
import { checkTotal } from '@/lib/receipts/invariant'
import { evaluateAllowance, startOfUtcDay } from '@/lib/receipts/limit'
import { receiptImageStoreFromEnv } from '@/lib/receipts/storage'

/**
 * Reads a receipt photo into line items.
 *
 * The Gemini key lives only here (brief §26-29, §187): the browser posts an
 * already-resized JPEG and gets back parsed items, never a model credential
 * and never a provider URL.
 *
 * Everything the client is told is deliberately coarse — `error` is one of a
 * handful of codes it can act on. Raw model output is logged server-side for
 * debugging and never returned, because it is the one thing in this path that
 * could carry an unvalidated payload.
 */

type ErrorCode =
  | 'UNAUTHENTICATED'
  | 'NOT_A_MEMBER'
  | 'BAD_REQUEST'
  | 'IMAGE_TOO_LARGE'
  | 'DAILY_LIMIT_REACHED'
  | 'RATE_LIMITED'
  | 'TIMEOUT'
  | 'PARSE_FAILED'
  | 'NOT_CONFIGURED'

function fail(error: ErrorCode, status: number, extra: Record<string, unknown> = {}): Response {
  return Response.json({ ok: false, error, ...extra }, { status })
}

export async function POST(request: Request): Promise<Response> {
  const session = await auth()
  const userId = session?.user?.id
  if (!userId) return fail('UNAUTHENTICATED', 401)

  const apiKey = process.env.GEMINI_API_KEY
  if (!apiKey) return fail('NOT_CONFIGURED', 503)

  let form: FormData
  try {
    form = await request.formData()
  } catch {
    return fail('BAD_REQUEST', 400)
  }

  const groupId = form.get('groupId')
  const image = form.get('image')
  if (typeof groupId !== 'string' || !groupId || !(image instanceof Blob)) {
    return fail('BAD_REQUEST', 400)
  }

  // Membership, not merely a session: receipts are group data and the group
  // id decides where the photo is stored. A non-member gets the same answer a
  // non-existent group would, so this is no group-existence oracle.
  const member = await prisma.member.findFirst({
    where: { groupId, userId, leftAt: null },
    select: { id: true },
  })
  if (!member) return fail('NOT_A_MEMBER', 404)

  if (image.size > RECEIPT_MAX_UPLOAD_BYTES) return fail('IMAGE_TOO_LARGE', 413)
  if (image.size === 0) return fail('BAD_REQUEST', 400)

  // Daily cap (brief §181). Counted BEFORE the call, over both successful and
  // failed attempts — a parse that returned nothing still cost tokens, and a
  // limit that only counted successes would not stop a stuck client.
  const usedToday = await prisma.receiptScan.count({
    where: { userId, createdAt: { gte: startOfUtcDay(new Date()) } },
  })
  const allowance = evaluateAllowance(usedToday, RECEIPT_DAILY_SCAN_LIMIT)
  if (!allowance.allowed) {
    return fail('DAILY_LIMIT_REACHED', 429, { limit: allowance.limit })
  }

  const bytes = new Uint8Array(await image.arrayBuffer())
  const parser = new GeminiReceiptParser(apiKey)
  const store = receiptImageStoreFromEnv()

  // Stored ALONGSIDE the parse, not after it. The brief keeps the photo even
  // when parsing fails (§162-163) — the user falls back to typing and the
  // photo still attaches — so the upload cannot hang off the success branch.
  // Running it concurrently also keeps it off the critical path, so the
  // success case is no slower for it.
  // Best-effort: a storage outage must not cost the user a parse they can use.
  const uploading: Promise<string | null> = store
    ? store.put(groupId, bytes).catch((error) => {
        console.error(
          JSON.stringify({ tag: 'receipt-image-upload-failed', groupId, error: String(error) }),
        )
        return null
      })
    : Promise.resolve(null)

  const outcome = await parser.parse(bytes, { signal: request.signal })
  const imagePath = await uploading

  const usage = outcome.usage ?? {
    inputTokens: 0,
    outputTokens: 0,
    thinkingTokens: 0,
    totalTokens: 0,
    latencyMs: 0,
  }
  // Usage log (brief §183). Recorded for failures too, so the bill and the
  // limit both reflect what was actually spent.
  await prisma.receiptScan.create({
    data: {
      userId,
      groupId,
      outcome: outcome.ok ? 'OK' : outcome.kind,
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
      thinkingTokens: usage.thinkingTokens,
      latencyMs: usage.latencyMs,
    },
  })

  if (!outcome.ok) {
    if (outcome.raw) {
      console.error(
        JSON.stringify({ tag: 'receipt-parse-failed', kind: outcome.kind, raw: outcome.raw.slice(0, 4000) }),
      )
    }
    // The path travels with the failure so the manual-entry exit can still
    // attach the photo to the expense the user types in by hand.
    if (outcome.kind === 'RATE_LIMITED') return fail('RATE_LIMITED', 429, { imagePath })
    if (outcome.kind === 'TIMEOUT') return fail('TIMEOUT', 504, { imagePath })
    return fail('PARSE_FAILED', 502, { imagePath })
  }

  return Response.json({
    ok: true,
    receipt: outcome.receipt,
    check: checkTotal(outcome.receipt),
    imagePath,
    remaining: allowance.remaining - 1,
  })
}
