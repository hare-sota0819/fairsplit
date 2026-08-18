import { RECEIPT_BUCKET, RECEIPT_SIGNED_URL_TTL_SECONDS } from './config'

/**
 * Receipt-image storage, PHASE5_RECEIPT_PROMPT.md §168-176.
 *
 * Behind an interface for the same reason `ReceiptParser` is: the storage
 * backend is a deployment detail, and the delete-on-group-delete path needs a
 * fake to be testable without a live bucket.
 */
export interface ReceiptImageStore {
  /** Store resized JPEG bytes under a group-keyed path; returns that path. */
  put(groupId: string, image: Uint8Array): Promise<string>
  /** A short-lived readable URL. Callers MUST check membership first. */
  signedUrl(path: string): Promise<string | null>
  /** Remove objects. Missing objects are not an error. */
  remove(paths: readonly string[]): Promise<void>
}

/**
 * Object path for a group's receipt. The group id is the first segment so a
 * group's images can be listed and removed as a unit, and so a storage policy
 * could later scope on the prefix.
 *
 * `randomUUID` rather than the expense id: the image is uploaded BEFORE the
 * expense exists (the confirm screen can be abandoned), so there is no id to
 * name it after yet.
 */
export function receiptObjectPath(groupId: string, uuid: string): string {
  return `${groupId}/${uuid}.jpg`
}

/**
 * The group a stored path belongs to, or null if the path is not one of ours.
 *
 * This is the anchor for the membership check that guards every read, so it is
 * strict by construction: exactly two non-empty segments, no traversal, and a
 * filename shaped like the one `receiptObjectPath` writes. Accepting anything
 * looser would let `otherGroup/../myGroup/x.jpg` be authorised against the
 * caller's own group and then read from someone else's.
 */
const RECEIPT_PATH = /^([A-Za-z0-9_-]+)\/([A-Za-z0-9-]+)\.jpg$/

export function groupIdFromPath(path: string): string | null {
  return RECEIPT_PATH.exec(path)?.[1] ?? null
}

/**
 * Is this key a legacy JWT (`service_role`/`anon`) rather than one of the new
 * `sb_secret_`/`sb_publishable_` keys?
 *
 * Matched on JWT shape, not on the `sb_` prefix, so an unrecognised future key
 * format defaults to the safe behaviour (apikey only) instead of being sent as
 * a Bearer token the platform will try and fail to parse.
 */
export function isJwtKey(key: string): boolean {
  return /^eyJ[A-Za-z0-9_-]*\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(key)
}

export class SupabaseReceiptImageStore implements ReceiptImageStore {
  private readonly baseUrl: string
  private readonly serviceKey: string
  private readonly bucket: string

  constructor(baseUrl: string, serviceKey: string, bucket: string = RECEIPT_BUCKET) {
    // Talked to over the storage REST API rather than @supabase/supabase-js:
    // three endpoints do not justify a dependency, and the service-role key
    // must stay server-side either way.
    this.baseUrl = baseUrl.replace(/\/+$/, '')
    this.serviceKey = serviceKey
    this.bucket = bucket
  }

  private headers(extra: Record<string, string> = {}): Record<string, string> {
    // `apikey` carries the credential for BOTH key formats. The
    // `Authorization: Bearer` header is added only for a legacy service_role
    // JWT, because Supabase's new `sb_secret_...` keys are not JWTs: the
    // platform tries to parse a Bearer value as one and rejects the request
    // (supabase.com/docs/guides/getting-started/api-keys, "Known limitations
    // and compatibility differences"). Sending both unconditionally therefore
    // breaks on exactly the key format this project deploys with.
    return {
      apikey: this.serviceKey,
      ...(isJwtKey(this.serviceKey) ? { authorization: `Bearer ${this.serviceKey}` } : {}),
      ...extra,
    }
  }

  async put(groupId: string, image: Uint8Array): Promise<string> {
    const path = receiptObjectPath(groupId, crypto.randomUUID())
    const res = await fetch(`${this.baseUrl}/storage/v1/object/${this.bucket}/${path}`, {
      method: 'POST',
      headers: this.headers({ 'content-type': 'image/jpeg', 'cache-control': '3600' }),
      body: image as unknown as BodyInit,
    })
    if (!res.ok) throw new Error(`receipt upload failed: ${res.status}`)
    return path
  }

  async signedUrl(path: string): Promise<string | null> {
    const res = await fetch(`${this.baseUrl}/storage/v1/object/sign/${this.bucket}/${path}`, {
      method: 'POST',
      headers: this.headers({ 'content-type': 'application/json' }),
      body: JSON.stringify({ expiresIn: RECEIPT_SIGNED_URL_TTL_SECONDS }),
    })
    if (!res.ok) return null
    const json = (await res.json()) as { signedURL?: string; signedUrl?: string }
    const relative = json.signedURL ?? json.signedUrl
    return relative ? `${this.baseUrl}/storage/v1${relative}` : null
  }

  async remove(paths: readonly string[]): Promise<void> {
    if (paths.length === 0) return
    // Deletion is best-effort on purpose: an orphaned object costs a few KB,
    // but throwing here would abort the group deletion the user asked for.
    await fetch(`${this.baseUrl}/storage/v1/object/${this.bucket}`, {
      method: 'DELETE',
      headers: this.headers({ 'content-type': 'application/json' }),
      body: JSON.stringify({ prefixes: [...paths] }),
    }).catch(() => undefined)
  }
}

/**
 * The configured store, or null when the deployment has no storage credentials.
 *
 * Null is a supported state, not a crash: scanning still works and the parsed
 * items still save, the expense simply carries no photo. Making the whole
 * feature depend on a bucket being provisioned would take the scan path down
 * with it.
 */
export function receiptImageStoreFromEnv(): ReceiptImageStore | null {
  const url = process.env.SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) return null
  return new SupabaseReceiptImageStore(url, key)
}
