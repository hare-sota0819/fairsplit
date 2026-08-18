import { describe, expect, it } from 'vitest'
import { uniqueInitials } from './initials'

describe('uniqueInitials', () => {
  it('uses the first character when no names collide', () => {
    const labels = uniqueInitials(['수탉', '민지', '하늘'])
    expect(labels.get('수탉')).toBe('수')
    expect(labels.get('민지')).toBe('민')
    expect(labels.get('하늘')).toBe('하')
  })

  it('extends colliding names until they are distinguishable', () => {
    const labels = uniqueInitials(['수이수이', '수탉'])
    expect(labels.get('수이수이')).toBe('수이')
    expect(labels.get('수탉')).toBe('수탉')
  })

  it('extends only the colliding names, not the whole roster', () => {
    const labels = uniqueInitials(['수이수이', '수탉', '민지'])
    expect(labels.get('민지')).toBe('민')
  })

  it('falls back to the full name when one name prefixes another', () => {
    const labels = uniqueInitials(['수이', '수이수이'])
    expect(labels.get('수이')).toBe('수이')
    expect(labels.get('수이수이')).toBe('수이수')
  })

  it('gives identical names their identical full name', () => {
    const labels = uniqueInitials(['수이', '수이'])
    expect(labels.get('수이')).toBe('수이')
  })

  it('counts astral code points as one character', () => {
    const labels = uniqueInitials(['😀 park', '민지'])
    expect(labels.get('😀 park')).toBe('😀')
  })
})
