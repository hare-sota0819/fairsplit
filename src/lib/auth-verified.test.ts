import { describe, expect, it } from 'vitest'
import Credentials from 'next-auth/providers/credentials'
import Google from 'next-auth/providers/google'
import { stampEmailVerified, vouchesForEmail } from './auth-verified'

const NOW = new Date('2026-08-20T00:00:00.000Z')

interface Call {
  where: { id: string; emailVerified: null }
  data: { emailVerified: Date }
}

function store(count = 1) {
  const calls: Call[] = []
  return {
    calls,
    user: {
      updateMany: async (args: Call) => {
        calls.push(args)
        return { count }
      },
    },
  }
}

// DECISIONS D2-17: `User.emailVerified` gains a producer, so the dev role
// gate can test the column alone instead of carrying an OR clause that
// re-states the same claim.
describe('vouchesForEmail (D2-17)', () => {
  it('accepts the type the configured Google provider actually declares', () => {
    expect(vouchesForEmail({ type: Google({}).type })).toBe(true)
  })
  it('refuses the credentials provider — that is the unverified signup', () => {
    expect(
      vouchesForEmail({ type: Credentials({ credentials: {} }).type }),
    ).toBe(false)
  })
  it('refuses a missing or unknown account', () => {
    expect(vouchesForEmail(null)).toBe(false)
    expect(vouchesForEmail(undefined)).toBe(false)
    expect(vouchesForEmail({})).toBe(false)
    expect(vouchesForEmail({ type: 'email' })).toBe(false)
  })
})

describe('stampEmailVerified (D2-17)', () => {
  it('stamps an OAuth sign-in that has no timestamp yet', async () => {
    const s = store()
    await expect(
      stampEmailVerified(s, { user: { id: 'u1' }, account: { type: 'oidc' } }, NOW),
    ).resolves.toBe(true)
    expect(s.calls).toEqual([
      { where: { id: 'u1', emailVerified: null }, data: { emailVerified: NOW } },
    ])
  })
  it('never moves an existing timestamp — the write is scoped to null rows', async () => {
    const s = store(0)
    await expect(
      stampEmailVerified(s, { user: { id: 'u1' }, account: { type: 'oauth' } }, NOW),
    ).resolves.toBe(false)
    expect(s.calls[0].where.emailVerified).toBeNull()
  })
  it('writes NOTHING for a credentials sign-in', async () => {
    const s = store()
    await expect(
      stampEmailVerified(
        s,
        { user: { id: 'u1' }, account: { type: 'credentials' } },
        NOW,
      ),
    ).resolves.toBe(false)
    expect(s.calls).toEqual([])
  })
  it('writes nothing without a user id', async () => {
    const s = store()
    await expect(
      stampEmailVerified(s, { user: {}, account: { type: 'oidc' } }, NOW),
    ).resolves.toBe(false)
    expect(s.calls).toEqual([])
  })
})
