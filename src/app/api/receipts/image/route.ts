import { auth } from '@/auth'
import { prisma } from '@/lib/prisma'
import { groupIdFromPath, receiptImageStoreFromEnv } from '@/lib/receipts/storage'

/**
 * Serve a receipt photo to a member of the group it belongs to.
 *
 * Access control (brief §175). The bucket is private, so no object has a
 * public URL at all; the only way to read one is a signed URL minted here,
 * and that only happens after the caller is confirmed to be a current member
 * of the group the path is keyed by.
 *
 * Supabase RLS is not usable for this: its policies evaluate a Supabase JWT,
 * and this app authenticates with Auth.js and its own tables, so the database
 * has no idea who the caller is. See OPEN_QUESTIONS.md #3.
 *
 * The group is taken from the PATH, never from a query parameter the caller
 * could set independently — otherwise someone could pair their own group id
 * with another group's object. `groupIdFromPath` is strict for the same
 * reason: it rejects traversal and anything not shaped like what we wrote.
 */
export async function GET(request: Request): Promise<Response> {
  const session = await auth()
  const userId = session?.user?.id
  if (!userId) return new Response(null, { status: 401 })

  const path = new URL(request.url).searchParams.get('path') ?? ''
  const groupId = groupIdFromPath(path)
  if (!groupId) return new Response(null, { status: 400 })

  const member = await prisma.member.findFirst({
    where: { groupId, userId, leftAt: null },
    select: { id: true },
  })
  // A non-member gets the same answer a non-existent image would, so this
  // cannot be used to discover which groups or receipts exist.
  if (!member) return new Response(null, { status: 404 })

  // The image must actually belong to an expense in that group. Without this,
  // a member could read any object under their own group's prefix, including
  // one uploaded for a scan that was abandoned by someone else.
  const expense = await prisma.expense.findFirst({
    where: { groupId, receiptImagePath: path },
    select: { id: true },
  })
  if (!expense) return new Response(null, { status: 404 })

  const store = receiptImageStoreFromEnv()
  if (!store) return new Response(null, { status: 503 })

  const url = await store.signedUrl(path)
  if (!url) return new Response(null, { status: 404 })

  // A redirect rather than a proxy: the bytes go straight from storage to the
  // phone instead of through a serverless function, and the signed URL is
  // short-lived so the redirect target cannot be shared usefully.
  return Response.redirect(url, 307)
}
