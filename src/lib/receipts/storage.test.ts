import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  SupabaseReceiptImageStore,
  groupIdFromPath,
  isJwtKey,
  receiptObjectPath,
} from './storage'

describe('receiptObjectPath', () => {
  it('keys the object by group so a group’s images can be removed as a unit', () => {
    expect(receiptObjectPath('grp_1', 'abc-123')).toBe('grp_1/abc-123.jpg')
  })
})

describe('groupIdFromPath', () => {
  it('reads the group back out', () => {
    expect(groupIdFromPath('grp_1/abc-123.jpg')).toBe('grp_1')
  })

  it('refuses a path with no group segment', () => {
    expect(groupIdFromPath('abc-123.jpg')).toBeNull()
  })

  it('refuses a nested path, so a crafted value cannot escape its group prefix', () => {
    expect(groupIdFromPath('grp_1/../grp_2/abc.jpg')).toBeNull()
  })

  it('refuses an empty string', () => {
    expect(groupIdFromPath('')).toBeNull()
  })

  it('round-trips what receiptObjectPath produced', () => {
    const path = receiptObjectPath('grp_xyz', 'uuid-1')
    expect(groupIdFromPath(path)).toBe('grp_xyz')
  })
})

describe('isJwtKey', () => {
  it('recognises a legacy service_role JWT', () => {
    expect(isJwtKey('eyJhbGciOiJIUzI1NiJ9.eyJyb2xlIjoic2VydmljZV9yb2xlIn0.sig-part')).toBe(true)
  })

  it('rejects a new-format secret key', () => {
    expect(isJwtKey('sb_secret_example_not_real')).toBe(false)
  })

  it('rejects an unrecognised shape, so the safe path is the default', () => {
    expect(isJwtKey('not.a.jwt!')).toBe(false)
    expect(isJwtKey('')).toBe(false)
  })
})

describe('SupabaseReceiptImageStore auth headers', () => {
  afterEach(() => vi.unstubAllGlobals())

  function capture(key: string): () => Record<string, string> {
    const seen: Record<string, string>[] = []
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: string, init: { headers: Record<string, string> }) => {
        seen.push(init.headers)
        return { ok: true } as Response
      }),
    )
    return () => seen[0]!
  }

  it('sends a new-format secret key as apikey ONLY — a Bearer value is parsed as a JWT and rejected', async () => {
    const headers = capture('sb_secret_example_not_real')
    const store = new SupabaseReceiptImageStore(
      'https://p.supabase.co',
      'sb_secret_example_not_real',
    )
    await store.put('grp_1', new Uint8Array([1, 2, 3]))
    expect(headers().apikey).toBe('sb_secret_example_not_real')
    expect(headers().authorization).toBeUndefined()
  })

  it('still sends a legacy service_role JWT as both, so an older deployment keeps working', async () => {
    const jwt = 'eyJhbGciOiJIUzI1NiJ9.eyJyb2xlIjoic2VydmljZV9yb2xlIn0.sig-part'
    const headers = capture(jwt)
    const store = new SupabaseReceiptImageStore('https://p.supabase.co', jwt)
    await store.put('grp_1', new Uint8Array([1, 2, 3]))
    expect(headers().apikey).toBe(jwt)
    expect(headers().authorization).toBe(`Bearer ${jwt}`)
  })
})

describe('groupIdFromPath — hostile input', () => {
  const rejected = [
    'grp_1/../grp_2/abc.jpg',
    '../grp_1/abc.jpg',
    'grp_1/abc.jpg/../../other/x.jpg',
    '/grp_1/abc.jpg',
    'grp_1//abc.jpg',
    'grp_1/abc.png',
    'grp_1/abc',
    'grp_1/',
    'https://evil.example/x.jpg',
  ]
  it.each(rejected)('refuses %s', (path) => {
    expect(groupIdFromPath(path)).toBeNull()
  })
})
