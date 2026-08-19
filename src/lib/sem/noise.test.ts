import { describe, expect, it } from 'vitest'
import { SimplexNoise3D } from './noise'

describe('SimplexNoise3D', () => {
  it('is bounded in about [-1, 1] and not constant', () => {
    const n = new SimplexNoise3D(7)
    let min = Infinity
    let max = -Infinity
    for (let i = 0; i < 5000; i++) {
      const v = n.noise(i * 0.137, i * 0.071, i * 0.053)
      min = Math.min(min, v)
      max = Math.max(max, v)
    }
    expect(min).toBeGreaterThanOrEqual(-1.05)
    expect(max).toBeLessThanOrEqual(1.05)
    expect(max - min).toBeGreaterThan(0.5)
  })

  it('is deterministic for a seed and different across seeds', () => {
    const a = new SimplexNoise3D(1)
    const b = new SimplexNoise3D(1)
    const c = new SimplexNoise3D(2)
    expect(a.noise(0.3, 0.7, 1.1)).toBe(b.noise(0.3, 0.7, 1.1))
    let differs = false
    for (let i = 0; i < 50 && !differs; i++) {
      differs = a.noise(i * 0.31, 0.2, 0.9) !== c.noise(i * 0.31, 0.2, 0.9)
    }
    expect(differs).toBe(true)
  })
})
