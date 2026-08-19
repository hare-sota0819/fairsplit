import { describe, expect, it } from 'vitest'
import {
  FACE_COUNT,
  SOLID_IDS,
  pickNextSolid,
  projectToSolid,
  radiusAlong,
  solidFaces,
  type Vec3,
} from './platonic'

function fib(count: number): Vec3[] {
  const dirs: Vec3[] = []
  const golden = Math.PI * (3 - Math.sqrt(5))
  for (let i = 0; i < count; i++) {
    const y = 1 - (2 * (i + 0.5)) / count
    const r = Math.sqrt(Math.max(0, 1 - y * y))
    dirs.push([Math.cos(golden * i) * r, y, Math.sin(golden * i) * r])
  }
  return dirs
}

describe('solidFaces', () => {
  it.each(SOLID_IDS)('%s has the classical face count with unit normals', (id) => {
    const faces = solidFaces(id)
    expect(faces).toHaveLength(FACE_COUNT[id])
    for (const { n } of faces) {
      expect(Math.hypot(n[0], n[1], n[2])).toBeCloseTo(1, 9)
    }
  })

  it.each(SOLID_IDS)('%s is scaled to mean radius ≈ 1', (id) => {
    const faces = solidFaces(id)
    const dirs = fib(4096)
    const mean = dirs.reduce((s, d) => s + radiusAlong(faces, d), 0) / dirs.length
    expect(mean).toBeCloseTo(1, 2)
  })

  it.each(SOLID_IDS)('%s radius is finite and bounded in every direction', (id) => {
    const faces = solidFaces(id)
    for (const d of fib(1024)) {
      const r = radiusAlong(faces, d)
      expect(Number.isFinite(r)).toBe(true)
      expect(r).toBeGreaterThan(0.5)
      expect(r).toBeLessThan(2.5)
    }
  })

  it('cube: the axis direction hits the face centre (inradius) and the corner is √3 further', () => {
    const faces = solidFaces('cube')
    const along = radiusAlong(faces, [1, 0, 0])
    const corner = radiusAlong(faces, [1 / Math.sqrt(3), 1 / Math.sqrt(3), 1 / Math.sqrt(3)])
    expect(corner / along).toBeCloseTo(Math.sqrt(3), 6)
  })
})

describe('pickNextSolid', () => {
  it('never returns the previous solid', () => {
    for (const prev of SOLID_IDS) {
      for (let i = 0; i < 20; i++) {
        expect(pickNextSolid(prev, () => i / 20)).not.toBe(prev)
      }
    }
  })
  it('with no previous, any solid is possible', () => {
    expect(new Set(SOLID_IDS.map((_, i) => pickNextSolid(null, () => i / 5))).size).toBe(5)
  })
})

describe('projectToSolid (edge/corner snapping)', () => {
  const onSurface = (id: (typeof SOLID_IDS)[number]) => {
    const faces = solidFaces(id)
    for (const d of fib(3000)) {
      const p = projectToSolid(faces, d)
      // Inside or on every plane, and on at least one.
      let maxSigned = -Infinity
      for (const { n, k } of faces) {
        const signed = n[0] * p[0] + n[1] * p[1] + n[2] * p[2] - k
        expect(signed).toBeLessThan(1e-6)
        maxSigned = Math.max(maxSigned, signed)
      }
      expect(maxSigned).toBeGreaterThan(-1e-6)
    }
  }
  it.each(SOLID_IDS)('%s: every projected point lies on the surface', onSurface)

  it('a direction near a cube edge snaps exactly onto that edge', () => {
    const faces = solidFaces('cube')
    const k = faces[0].k
    // Just off the +x/+y edge, well inside the band.
    const raw: Vec3 = [1, 0.98, 0.1]
    const len = Math.hypot(...raw)
    const p = projectToSolid(faces, [raw[0] / len, raw[1] / len, raw[2] / len])
    expect(p[0]).toBeCloseTo(k, 6)
    expect(p[1]).toBeCloseTo(k, 6)
  })

  it('a direction near a cube corner snaps exactly onto the corner', () => {
    const faces = solidFaces('cube')
    const k = faces[0].k
    const raw: Vec3 = [1, 0.985, 0.97]
    const len = Math.hypot(...raw)
    const p = projectToSolid(faces, [raw[0] / len, raw[1] / len, raw[2] / len])
    expect(p[0]).toBeCloseTo(k, 6)
    expect(p[1]).toBeCloseTo(k, 6)
    expect(p[2]).toBeCloseTo(k, 6)
  })

  it('a direction in the middle of a face is the plain radial hit', () => {
    const faces = solidFaces('cube')
    const p = projectToSolid(faces, [1, 0, 0])
    expect(p).toEqual([radiusAlong(faces, [1, 0, 0]), 0, 0])
  })
})
