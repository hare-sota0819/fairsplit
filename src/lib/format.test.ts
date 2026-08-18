import { describe, expect, test } from 'vitest'
import {
  formatMinor,
  formatRelativeTime,
  minorToDecimalInput,
  parseAmountToMinor,
} from './format'

describe('formatMinor', () => {
  test('zero-decimal and two-decimal currencies', () => {
    expect(formatMinor(3_334n, 'KRW')).toBe('₩3,334')
    expect(formatMinor(-3_334n, 'KRW')).toBe('-₩3,334')
    expect(formatMinor(150n, 'USD')).toBe('$1.50')
  })
})

describe('parseAmountToMinor', () => {
  test('exact minor units, no floats', () => {
    expect(parseAmountToMinor('4900', 'KRW')).toBe(4_900n)
    expect(parseAmountToMinor('1.50', 'USD')).toBe(150n)
    expect(parseAmountToMinor('1.5', 'USD')).toBe(150n)
  })

  test('negative amounts are refunds', () => {
    expect(parseAmountToMinor('-3000', 'KRW')).toBe(-3_000n)
    expect(parseAmountToMinor('-1.50', 'USD')).toBe(-150n)
    expect(parseAmountToMinor('-0', 'KRW')).toBe(0n)
  })

  test('rejects malformed and over-precise input', () => {
    expect(parseAmountToMinor('', 'KRW')).toBeNull()
    expect(parseAmountToMinor('1.234', 'USD')).toBeNull()
    expect(parseAmountToMinor('1.5', 'KRW')).toBeNull()
    expect(parseAmountToMinor('--3', 'KRW')).toBeNull()
  })
})

describe('minorToDecimalInput', () => {
  test('round-trips with parseAmountToMinor', () => {
    expect(minorToDecimalInput(4_900n, 'KRW')).toBe('4900')
    expect(minorToDecimalInput(150n, 'USD')).toBe('1.50')
    expect(minorToDecimalInput(5n, 'USD')).toBe('0.05')
    expect(minorToDecimalInput(-150n, 'USD')).toBe('-1.50')
    expect(minorToDecimalInput(-3_000n, 'KRW')).toBe('-3000')
  })
})

describe('formatRelativeTime', () => {
  test('minute and hour buckets', () => {
    const t = new Date('2026-07-31T12:00:00Z')
    expect(formatRelativeTime(new Date('2026-07-31T11:59:40Z'), t)).toBe('0m')
    expect(formatRelativeTime(new Date('2026-07-31T11:55:00Z'), t)).toBe('5m')
    expect(formatRelativeTime(new Date('2026-07-31T10:00:00Z'), t)).toBe('2h')
  })
})
