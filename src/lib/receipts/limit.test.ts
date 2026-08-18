import { describe, expect, it } from 'vitest'
import { evaluateAllowance, startOfUtcDay } from './limit'

describe('startOfUtcDay', () => {
  it('truncates to midnight UTC', () => {
    expect(startOfUtcDay(new Date('2026-08-08T13:42:07.123Z')).toISOString()).toBe(
      '2026-08-08T00:00:00.000Z',
    )
  })

  it('is already midnight at midnight', () => {
    expect(startOfUtcDay(new Date('2026-08-08T00:00:00.000Z')).toISOString()).toBe(
      '2026-08-08T00:00:00.000Z',
    )
  })

  it('puts 08:30 Tokyo on the previous UTC day, which is the documented trade', () => {
    // 2026-08-08 08:30 JST is 2026-08-07 23:30 UTC.
    expect(startOfUtcDay(new Date('2026-08-07T23:30:00.000Z')).toISOString()).toBe(
      '2026-08-07T00:00:00.000Z',
    )
  })
})

describe('evaluateAllowance', () => {
  it('allows a first scan', () => {
    expect(evaluateAllowance(0, 50)).toEqual({
      allowed: true,
      used: 0,
      limit: 50,
      remaining: 50,
    })
  })

  it('allows the last scan under the limit', () => {
    expect(evaluateAllowance(49, 50)).toMatchObject({ allowed: true, remaining: 1 })
  })

  it('refuses exactly at the limit', () => {
    expect(evaluateAllowance(50, 50)).toMatchObject({ allowed: false, remaining: 0 })
  })

  it('refuses past the limit and never reports a negative remainder', () => {
    expect(evaluateAllowance(80, 50)).toMatchObject({
      allowed: false,
      used: 80,
      remaining: 0,
    })
  })

  it('defaults to the configured limit of 50', () => {
    expect(evaluateAllowance(0).limit).toBe(50)
  })

  it('treats a nonsensical negative count as zero used', () => {
    expect(evaluateAllowance(-3, 50)).toMatchObject({ allowed: true, used: 0 })
  })
})
