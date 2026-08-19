/**
 * The five Platonic solids as face-plane sets, for Sem's constant-topology
 * morphing (docs/BRAND.md v2 §4b).
 *
 * Every solid is described by its faces only: unit outward normal `n` and
 * plane offset `k` (the face lies at `dot(n, p) = k`). Each set is scaled
 * so the solid's MEAN radius over the sphere is ≈ 1, which keeps the
 * morph volume-stable — a sphere of radius 1 morphs into a solid whose
 * points sit around radius 1 on average, so it neither swells nor shrinks
 * as it changes shape.
 *
 * `radiusAlong(d)` is the whole trick: the radius of a convex polyhedron
 * along a unit direction `d` is the nearest face-plane hit,
 * `min over faces with dot(n,d) > 0 of k / dot(n,d)`. Sampled once per
 * vertex of a subdivided sphere it turns that sphere into a crisp solid
 * with no topology change at all.
 *
 * Pure math, no three.js — unit-tested in platonic.test.ts.
 */

export type Vec3 = readonly [number, number, number]

export interface FacePlane {
  /** Unit outward normal. */
  n: Vec3
  /** Plane offset: the face lies at dot(n, p) = k. */
  k: number
}

export const SOLID_IDS = ['tetra', 'cube', 'octa', 'dodeca', 'icosa'] as const
export type SolidId = (typeof SOLID_IDS)[number]

const PHI = (1 + Math.sqrt(5)) / 2

function normalize(v: Vec3): Vec3 {
  const len = Math.hypot(v[0], v[1], v[2])
  return [v[0] / len, v[1] / len, v[2] / len]
}

/** Every sign combination of the given absolute components. */
function signed(abs: Vec3): Vec3[] {
  const out: Vec3[] = []
  for (const sx of [1, -1]) {
    for (const sy of [1, -1]) {
      for (const sz of [1, -1]) {
        out.push([abs[0] * sx, abs[1] * sy, abs[2] * sz])
      }
    }
  }
  return out
}

/** Even permutations of a triple (the three cyclic rotations). */
function cyclic(v: Vec3): Vec3[] {
  return [
    [v[0], v[1], v[2]],
    [v[1], v[2], v[0]],
    [v[2], v[0], v[1]],
  ]
}

/** Deduplicate directions (the sign/permutation generators repeat zeros). */
function unique(dirs: Vec3[]): Vec3[] {
  const seen = new Set<string>()
  const out: Vec3[] = []
  for (const d of dirs) {
    const key = d.map((c) => (Math.abs(c) < 1e-9 ? 0 : c).toFixed(6)).join(',')
    if (!seen.has(key)) {
      seen.add(key)
      out.push(d)
    }
  }
  return out
}

/** Raw (unscaled) face normals per solid: each is the dual solid's vertex set. */
function rawNormals(id: SolidId): Vec3[] {
  switch (id) {
    case 'tetra':
      // Four alternating cube corners.
      return (
        [
          [1, 1, 1],
          [1, -1, -1],
          [-1, 1, -1],
          [-1, -1, 1],
        ] as Vec3[]
      ).map(normalize)
    case 'cube':
      // Six axis directions (the octahedron's vertices).
      return [
        [1, 0, 0],
        [-1, 0, 0],
        [0, 1, 0],
        [0, -1, 0],
        [0, 0, 1],
        [0, 0, -1],
      ]
    case 'octa':
      // Eight cube corners.
      return signed([1, 1, 1]).map(normalize)
    case 'dodeca':
      // Twelve icosahedron vertices: cyclic (0, ±1, ±phi).
      return unique(
        cyclic([0, 1, PHI]).flatMap((base) => signed(base)),
      ).map(normalize)
    case 'icosa':
      // Twenty dodecahedron vertices: (±1,±1,±1) + cyclic (0, ±1/phi, ±phi).
      return unique([
        ...signed([1, 1, 1]),
        ...cyclic([0, 1 / PHI, PHI]).flatMap((base) => signed(base)),
      ]).map(normalize)
  }
}

/** Radius of the convex solid (unit inradius: every face at k = 1) along `d`. */
function radiusAlongUnitInradius(normals: Vec3[], d: Vec3): number {
  let r = Infinity
  for (const n of normals) {
    const dot = n[0] * d[0] + n[1] * d[1] + n[2] * d[2]
    if (dot > 1e-9) {
      const candidate = 1 / dot
      if (candidate < r) r = candidate
    }
  }
  return r
}

/** Fibonacci-sphere sample directions for the mean-radius normalisation. */
function sampleDirections(count: number): Vec3[] {
  const dirs: Vec3[] = []
  const golden = Math.PI * (3 - Math.sqrt(5))
  for (let i = 0; i < count; i++) {
    const y = 1 - (2 * (i + 0.5)) / count
    const r = Math.sqrt(Math.max(0, 1 - y * y))
    const theta = golden * i
    dirs.push([Math.cos(theta) * r, y, Math.sin(theta) * r])
  }
  return dirs
}

/** Face planes of a solid scaled so its mean radius over the sphere is 1. */
export function solidFaces(id: SolidId): FacePlane[] {
  const normals = rawNormals(id)
  const samples = sampleDirections(2048)
  let sum = 0
  for (const d of samples) sum += radiusAlongUnitInradius(normals, d)
  const meanRadius = sum / samples.length
  const k = 1 / meanRadius
  return normals.map((n) => ({ n, k }))
}

/** Radius of the solid described by `faces` along unit direction `d`. */
export function radiusAlong(faces: readonly FacePlane[], d: Vec3): number {
  let r = Infinity
  for (const { n, k } of faces) {
    const dot = n[0] * d[0] + n[1] * d[1] + n[2] * d[2]
    if (dot > 1e-9) {
      const candidate = k / dot
      if (candidate < r) r = candidate
    }
  }
  return r
}

/** Number of faces each solid must have — the classical counts. */
export const FACE_COUNT: Record<SolidId, number> = {
  tetra: 4,
  cube: 6,
  octa: 8,
  dodeca: 12,
  icosa: 20,
}

/** A random solid id different from `previous` (uniform over the rest). */
export function pickNextSolid(
  previous: SolidId | null,
  random: () => number = Math.random,
): SolidId {
  const pool = SOLID_IDS.filter((id) => id !== previous)
  return pool[Math.floor(random() * pool.length)]
}

/**
 * Where the solid's surface is along `d`, as a POINT — with edge and corner
 * snapping (docs/BRAND.md v2 §4b amendment 2026-08-18).
 *
 * The plain radial hit `d · radiusAlong(d)` puts every vertex exactly on
 * the surface, but a sphere mesh's triangles do not know where the solid's
 * edges are: any triangle whose three vertices land on two different faces
 * is tilted across the edge, and a whole ring of them reads as a sawtooth
 * band one triangle wide — visibly broken at 160px+. So a vertex whose
 * radial hit is within `band` (× its own radius) of a SECOND face plane is
 * slid, tangentially, onto the line where the two planes meet; if it is
 * also within `band` of a THIRD plane it is slid along that line onto the
 * corner. Triangles then end exactly on the solid's edges and corners: the
 * faces are truly flat and the edges razor-crisp, with the topology
 * untouched.
 */
export function projectToSolid(
  faces: readonly FacePlane[],
  d: Vec3,
  band = 0.06,
): [number, number, number] {
  // The three nearest face hits along d.
  let t1 = Infinity
  let t2 = Infinity
  let t3 = Infinity
  let f1: FacePlane | null = null
  let f2: FacePlane | null = null
  let f3: FacePlane | null = null
  for (const face of faces) {
    const dot = face.n[0] * d[0] + face.n[1] * d[1] + face.n[2] * d[2]
    if (dot <= 1e-9) continue
    const t = face.k / dot
    if (t < t1) {
      t3 = t2; f3 = f2
      t2 = t1; f2 = f1
      t1 = t; f1 = face
    } else if (t < t2) {
      t3 = t2; f3 = f2
      t2 = t; f2 = face
    } else if (t < t3) {
      t3 = t; f3 = face
    }
  }
  if (!f1) return [d[0], d[1], d[2]]
  let px = d[0] * t1
  let py = d[1] * t1
  let pz = d[2] * t1
  const eps = band * t1
  if (!f2) return [px, py, pz]

  // Distance from the hit point to the second plane (positive = inside).
  const dist2 = f2.k - (f2.n[0] * px + f2.n[1] * py + f2.n[2] * pz)
  if (dist2 > eps) return [px, py, pz]

  // Slide within plane 1 onto plane 2: along u = n2 minus its n1 component.
  const n1 = f1.n
  const n2 = f2.n
  const c = n1[0] * n2[0] + n1[1] * n2[1] + n1[2] * n2[2]
  const ux = n2[0] - c * n1[0]
  const uy = n2[1] - c * n1[1]
  const uz = n2[2] - c * n1[2]
  const uDotN2 = ux * n2[0] + uy * n2[1] + uz * n2[2]
  if (uDotN2 < 1e-9) return [px, py, pz]
  const s = dist2 / uDotN2
  px += ux * s
  py += uy * s
  pz += uz * s

  if (!f3) return [px, py, pz]
  const dist3 = f3.k - (f3.n[0] * px + f3.n[1] * py + f3.n[2] * pz)
  if (dist3 > eps) return [px, py, pz]

  // Slide along the edge line e = n1 × n2 onto plane 3 (the corner).
  const n3 = f3.n
  const ex = n1[1] * n2[2] - n1[2] * n2[1]
  const ey = n1[2] * n2[0] - n1[0] * n2[2]
  const ez = n1[0] * n2[1] - n1[1] * n2[0]
  const eDotN3 = ex * n3[0] + ey * n3[1] + ez * n3[2]
  if (Math.abs(eDotN3) < 1e-9) return [px, py, pz]
  const r = dist3 / eDotN3
  return [px + ex * r, py + ey * r, pz + ez * r]
}
