import { describe, expect, it, vi } from 'vitest'
import { decideScanAllowance } from './scan-limit'

describe('decideScanAllowance', () => {
  it('applies the cap to an ordinary account', async () => {
    expect(await decideScanAllowance('user', async () => 0, 50)).toEqual({
      allowed: true,
      limit: 50,
      remainingAfter: 49,
    })
    expect(await decideScanAllowance('user', async () => 49, 50)).toEqual({
      allowed: true,
      limit: 50,
      remainingAfter: 0,
    })
    expect(await decideScanAllowance('user', async () => 50, 50)).toEqual({
      allowed: false,
      limit: 50,
      remainingAfter: 0,
    })
  })

  it('lifts the cap for a dev account, however many scans it has run', async () => {
    for (const used of [0, 50, 5_000]) {
      expect(
        await decideScanAllowance('dev', async () => used, 50),
      ).toEqual({ allowed: true, limit: 50, remainingAfter: null })
    }
  })

  it('does not even COUNT for a dev account', async () => {
    const countToday = vi.fn(async () => 0)
    await decideScanAllowance('dev', countToday, 50)
    expect(countToday).not.toHaveBeenCalled()
  })

  it('counts exactly once for an ordinary account', async () => {
    const countToday = vi.fn(async () => 0)
    await decideScanAllowance('user', countToday, 50)
    expect(countToday).toHaveBeenCalledTimes(1)
  })

  it('never reports a negative remaining when the limit moved under someone', async () => {
    expect(
      (await decideScanAllowance('user', async () => 80, 50)).remainingAfter,
    ).toBe(0)
  })
})
