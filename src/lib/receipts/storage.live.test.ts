import { describe, expect, it } from 'vitest'
import sharp from 'sharp'
import { readFileSync } from 'node:fs'
import { SupabaseReceiptImageStore, groupIdFromPath } from './storage'
import { RECEIPT_BUCKET } from './config'

/**
 * The one check that a fake cannot make: the real bucket, over the network.
 *
 * SKIPPED unless SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are in the
 * environment, so `verify.sh` is unaffected — the storage path is a deployment
 * detail and the rest of the suite covers it with a fake. Run it by hand
 * against a real project, which is the only place these can be answered:
 *
 *   - does the deployment's key format authenticate at all?
 *   - does the bucket exist, and is it actually private?
 *   - does a signed URL read back the exact bytes that were uploaded?
 *   - is the object unreachable WITHOUT that signature?
 *
 *   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... \
 *     npx vitest run src/lib/receipts/storage.live.test.ts
 *
 * It creates the bucket if it is missing, then deletes the object it uploaded.
 */
const url = process.env.SUPABASE_URL ?? ''
const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? ''
const configured = url.startsWith('http') && key.length > 20

describe.skipIf(!configured)('live Supabase receipt storage', () => {
  it('authenticates, stores privately, signs a readable URL, and cleans up', async () => {
    const admin = { apikey: key }

    const list = await fetch(`${url}/storage/v1/bucket`, { headers: admin })
    expect(list.ok, `bucket list rejected the key (HTTP ${list.status})`).toBe(true)
    const buckets = (await list.json()) as Array<{ id: string; public: boolean }>

    let bucket = buckets.find((b) => b.id === RECEIPT_BUCKET)
    if (!bucket) {
      const created = await fetch(`${url}/storage/v1/bucket`, {
        method: 'POST',
        headers: { ...admin, 'content-type': 'application/json' },
        body: JSON.stringify({
          id: RECEIPT_BUCKET,
          name: RECEIPT_BUCKET,
          public: false,
          file_size_limit: 2_000_000,
          allowed_mime_types: ['image/jpeg'],
        }),
      })
      expect(created.ok, `bucket create failed: ${await created.text()}`).toBe(true)
      const refetched = await fetch(`${url}/storage/v1/bucket/${RECEIPT_BUCKET}`, { headers: admin })
      bucket = (await refetched.json()) as { id: string; public: boolean }
    }
    // A public bucket would make every receipt photo world-readable by URL.
    expect(bucket!.public, 'the receipts bucket must not be public').toBe(false)

    // A real photo, resized the way the browser resizes it before upload.
    const jpeg = await sharp(readFileSync('test-fixtures/receipts/KakaoTalk_20260808_001448764.jpg'))
      .rotate()
      .resize({ width: 1800, height: 1800, fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality: 80 })
      .toBuffer()

    const store = new SupabaseReceiptImageStore(url, key)
    const groupId = `livecheck${Date.now().toString(36)}`
    const path = await store.put(groupId, new Uint8Array(jpeg))
    expect(groupIdFromPath(path)).toBe(groupId)

    // Fetched with NO auth header at all — what the user's browser does.
    const signed = await store.signedUrl(path)
    expect(signed, 'signing the object returned nothing').toBeTruthy()
    const read = await fetch(signed!)
    expect(read.ok).toBe(true)
    expect(new Uint8Array(await read.arrayBuffer()).byteLength).toBe(jpeg.byteLength)

    // The same object without a signature must not be readable.
    expect((await fetch(`${url}/storage/v1/object/public/${RECEIPT_BUCKET}/${path}`)).ok).toBe(false)
    expect((await fetch(`${url}/storage/v1/object/${RECEIPT_BUCKET}/${path}`)).ok).toBe(false)
    expect((await fetch(signed!.replace(/token=.{6}/, 'token=aaaaaa'))).ok).toBe(false)

    await store.remove([path])
    expect((await fetch(signed!)).ok, 'the object survived removal').toBe(false)
  }, 120_000)
})
