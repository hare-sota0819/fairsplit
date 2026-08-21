import { describe, expect, it } from 'vitest'
import Credentials from 'next-auth/providers/credentials'
import Google from 'next-auth/providers/google'
import {
  accountRole,
  hasVerifiedIdentity,
  parseDevAllowlist,
  VERIFIED_ACCOUNT_TYPES,
} from './role-policy'

const VERIFIED = new Date('2026-08-01T00:00:00.000Z')

describe('parseDevAllowlist', () => {
  it('returns nothing for an unset or blank value', () => {
    expect(parseDevAllowlist(undefined)).toEqual([])
    expect(parseDevAllowlist(null)).toEqual([])
    expect(parseDevAllowlist('')).toEqual([])
    expect(parseDevAllowlist('   ')).toEqual([])
    expect(parseDevAllowlist(',,  ,')).toEqual([])
  })

  it('splits on commas and whitespace and lowercases', () => {
    expect(parseDevAllowlist('A@Example.com, b@example.com')).toEqual([
      'a@example.com',
      'b@example.com',
    ])
    expect(parseDevAllowlist('a@example.com\n b@example.com')).toEqual([
      'a@example.com',
      'b@example.com',
    ])
  })

  it('de-duplicates so a doubled entry cannot skew a length check', () => {
    expect(parseDevAllowlist('a@example.com, A@EXAMPLE.COM')).toEqual([
      'a@example.com',
    ])
  })
})

describe('hasVerifiedIdentity', () => {
  it('accepts a stamped emailVerified', () => {
    expect(
      hasVerifiedIdentity({ email: 'a@example.com', emailVerified: VERIFIED }),
    ).toBe(true)
  })

  // DECISIONS D2-17: the OR clause ("… or a linked OAuth account") is gone.
  // The claim it made now has a producer — `stampEmailVerified` writes the
  // column on every OAuth sign-in (src/lib/auth-verified.ts) — so this file
  // tests the column and nothing else. An OAuth account whose column is
  // still null is NOT verified here; stamping it is the event's job.
  it('rejects an unstamped account no matter how it signed in (D2-17)', () => {
    expect(
      hasVerifiedIdentity({
        email: 'a@example.com',
        emailVerified: null,
      }),
    ).toBe(false)
    expect(
      hasVerifiedIdentity({
        email: 'a@example.com',
        emailVerified: undefined,
      }),
    ).toBe(false)
  })
})

describe('accountRole', () => {
  const allowlist = parseDevAllowlist('dev@example.com, owner@example.com')

  it('grants dev to an allowlisted, verified account', () => {
    expect(
      accountRole(
        { email: 'dev@example.com', emailVerified: VERIFIED },
        allowlist,
      ),
    ).toBe('dev')
  })

  it('REFUSES an allowlisted address that is not verified — the squat this gate exists for (D2-17)', () => {
    expect(
      accountRole({ email: 'dev@example.com', emailVerified: null }, allowlist),
    ).toBe('user')
  })

  it('refuses a verified account that is not on the allowlist', () => {
    expect(
      accountRole(
        { email: 'stranger@example.com', emailVerified: VERIFIED },
        allowlist,
      ),
    ).toBe('user')
  })

  it('matches case-insensitively and ignores surrounding whitespace', () => {
    expect(
      accountRole(
        { email: '  DEV@Example.COM ', emailVerified: VERIFIED },
        allowlist,
      ),
    ).toBe('dev')
  })

  it('refuses an account with no address at all', () => {
    for (const email of [null, undefined, '', '   ']) {
      expect(
        accountRole({ email, emailVerified: VERIFIED }, allowlist),
      ).toBe('user')
    }
  })

  it('refuses everyone when the allowlist is empty', () => {
    expect(
      accountRole({ email: 'dev@example.com', emailVerified: VERIFIED }, []),
    ).toBe('user')
  })

  it('never matches a substring or a lookalike domain', () => {
    for (const email of [
      'dev@example.com.evil.com',
      'xdev@example.com',
      'dev@example.co',
      'dev@examp1e.com',
    ]) {
      expect(
        accountRole({ email, emailVerified: VERIFIED }, allowlist),
      ).toBe('user')
    }
  })
})

/**
 * The seam no unit test above can reach: the type set decides which sign-ins
 * `stampEmailVerified` (src/lib/auth-verified.ts) treats as vouching for the
 * address, and a test that hands it a hand-written string stays green no
 * matter what Auth.js really writes. The first cut of this gate filtered on
 * `type: 'oauth'` and matched nothing — Auth.js declares Google as `'oidc'` —
 * which made the whole role grantable to nobody, with 14 green tests. Under
 * D2-17 the same mistake would instead stamp nobody, with the same silence.
 *
 * So this reads the type off the CONFIGURED PROVIDERS themselves, at
 * runtime. If a dependency bump changes what Auth.js writes into
 * `Account.type`, this fails here instead of in production silence.
 */
describe('VERIFIED_ACCOUNT_TYPES vs the providers src/auth.ts actually configures', () => {
  it('covers the Google provider type', () => {
    expect(VERIFIED_ACCOUNT_TYPES).toContain(Google({}).type)
  })

  it('does NOT cover the credentials provider — that is the unverified signup', () => {
    expect(VERIFIED_ACCOUNT_TYPES).not.toContain(
      Credentials({ credentials: {} }).type,
    )
  })
})
