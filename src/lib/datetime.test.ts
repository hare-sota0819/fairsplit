import { describe, expect, test } from 'vitest'
import {
  formatLocalDateTime,
  fromLocalInputValue,
  toLocalDateKey,
  toLocalInputValue,
} from './datetime'

// Date#getTimezoneOffset() reports minutes WEST of UTC.
const KST = -540 // UTC+9  (Seoul)
const UTC = 0
const PST = 480 // UTC-8  (Los Angeles, winter)
const NPT = -345 // UTC+5:45 (Kathmandu — the half-hour-offset case)

describe('toLocalInputValue', () => {
  test('the reported bug: 07:41 UTC is 16:41 in Seoul', () => {
    const instant = new Date('2026-08-01T07:41:00.000Z')
    expect(toLocalInputValue(instant, KST)).toBe('2026-08-01T16:41')
    expect(toLocalInputValue(instant, UTC)).toBe('2026-08-01T07:41')
  })

  test('crossing back over midnight', () => {
    const instant = new Date('2026-08-01T02:00:00.000Z')
    expect(toLocalInputValue(instant, PST)).toBe('2026-07-31T18:00')
  })

  test('crossing forward over midnight', () => {
    const instant = new Date('2026-07-31T16:30:00.000Z')
    expect(toLocalInputValue(instant, KST)).toBe('2026-08-01T01:30')
  })

  test('non-whole-hour offsets', () => {
    const instant = new Date('2026-08-01T07:41:00.000Z')
    expect(toLocalInputValue(instant, NPT)).toBe('2026-08-01T13:26')
  })
})

describe('fromLocalInputValue', () => {
  test('16:41 typed in Seoul is 07:41 UTC', () => {
    expect(fromLocalInputValue('2026-08-01T16:41', KST)?.toISOString()).toBe(
      '2026-08-01T07:41:00.000Z',
    )
  })

  test('round-trips in every timezone', () => {
    const instant = new Date('2026-08-01T07:41:00.000Z')
    for (const offset of [KST, UTC, PST, NPT]) {
      const value = toLocalInputValue(instant, offset)
      expect(fromLocalInputValue(value, offset)?.toISOString()).toBe(
        instant.toISOString(),
      )
    }
  })

  test('accepts values that carry seconds', () => {
    expect(fromLocalInputValue('2026-08-01T16:41:30', KST)?.toISOString()).toBe(
      '2026-08-01T07:41:00.000Z',
    )
  })

  test('rejects malformed input', () => {
    expect(fromLocalInputValue('', KST)).toBeNull()
    expect(fromLocalInputValue('2026-08-01', KST)).toBeNull()
    expect(fromLocalInputValue('nope', KST)).toBeNull()
  })
})

describe('toLocalDateKey', () => {
  test('a late-evening expense in Seoul is not filed under the next day', () => {
    const instant = new Date('2026-08-01T14:30:00.000Z') // 23:30 KST
    expect(toLocalDateKey(instant, KST)).toBe('2026-08-01')
    expect(toLocalDateKey(instant, UTC)).toBe('2026-08-01')
    expect(toLocalDateKey(instant, PST)).toBe('2026-08-01')
  })

  test('after local midnight it rolls over', () => {
    const instant = new Date('2026-08-01T16:00:00.000Z') // 01:00 KST, Aug 2
    expect(toLocalDateKey(instant, KST)).toBe('2026-08-02')
    expect(toLocalDateKey(instant, UTC)).toBe('2026-08-01')
  })
})

describe('formatLocalDateTime', () => {
  test('renders in the device timezone, not the server one', () => {
    const instant = new Date('2026-08-01T07:41:00.000Z')
    expect(formatLocalDateTime(instant, KST, 'en')).toBe('Aug 1, 2026, 4:41 PM')
    expect(formatLocalDateTime(instant, UTC, 'en')).toBe('Aug 1, 2026, 7:41 AM')
  })

  test('follows the locale, so Korean reads as a Korean date', () => {
    const instant = new Date('2026-08-01T07:41:00.000Z')
    // The same instant and the same zone — only the language differs. This is
    // the whole reason the parameter exists.
    expect(formatLocalDateTime(instant, KST, 'ko')).toBe(
      '2026. 8. 1. 오후 4:41',
    )
  })
})
