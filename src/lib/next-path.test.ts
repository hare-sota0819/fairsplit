import { describe, expect, it } from 'vitest'
import { asPath, safeNext } from './next-path'

describe('safeNext', () => {
  it('keeps a same-origin path', () => {
    expect(safeNext('/groups/abc')).toBe('/groups/abc')
    expect(safeNext('/join/xyz?a=1')).toBe('/join/xyz?a=1')
  })

  it('rejects anything that could leave the origin', () => {
    expect(safeNext('//evil.example')).toBe('/')
    expect(safeNext('/\\evil.example')).toBe('/')
    expect(safeNext('https://evil.example')).toBe('/')
    expect(safeNext('javascript:alert(1)')).toBe('/')
  })

  it('falls back to the group list when there is nothing to continue to', () => {
    expect(safeNext(undefined)).toBe('/')
    expect(safeNext('')).toBe('/')
  })
})

describe('asPath', () => {
  it('reduces an absolute same-origin URL (what Auth.js hands back on callbackUrl) to a path', () => {
    expect(asPath('https://host/invite/abc')).toBe('/invite/abc')
  })

  it('reduces an absolute URL on ANY origin to a same-origin-relative path — harmless, not a leak', () => {
    expect(asPath('https://evil.example/x')).toBe('/x')
  })

  it('leaves a protocol-relative value for safeNext to reject, rather than accepting it itself', () => {
    expect(asPath('//evil.example')).toBe('//evil.example')
    expect(safeNext(asPath('//evil.example'))).toBe('/')
  })

  it('passes through a value that is already a path unchanged', () => {
    expect(asPath('/join/abc?x=1')).toBe('/join/abc?x=1')
  })

  it('passes through undefined unchanged', () => {
    expect(asPath(undefined)).toBeUndefined()
  })

  it('next wins over callbackUrl when both are present (the guide page rule)', () => {
    const next = '/join/abc'
    const callbackUrl = 'https://host/groups'
    const target =
      next !== undefined ? safeNext(next) : safeNext(asPath(callbackUrl))
    expect(target).toBe('/join/abc')
  })
})
