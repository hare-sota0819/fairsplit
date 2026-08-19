'use client'

import { useEffect, useRef } from 'react'
import * as THREE from 'three'
import { mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js'
import { SimplexNoise3D } from '@/lib/sem/noise'
import {
  pickNextSolid,
  projectToSolid,
  solidFaces,
  type SolidId,
} from '@/lib/sem/platonic'
import type { SemState } from './sem-state'

/**
 * Sem's body: one WebGL canvas, one mesh (docs/BRAND.md v2 §4).
 *
 * A finely faceted matte-vermilion orb that behaves like a small living
 * creature. Everything the brief specifies lives in this file, in the
 * order it lists it:
 *
 * - material/lighting (§4a): MeshStandardMaterial roughness 0.85,
 *   metalness 0, flatShading; one HemisphereLight (paper sky / ink
 *   ground) + one dim DirectionalLight from upper-left; no post-processing,
 *   no environment map, transparent canvas, DPR capped at 2.
 * - geometry/morph (§4b): a 2,562-vertex icosphere (see buildRig on
 *   three's `detail` units) merged to unique vertices; each vertex's unit
 *   direction is cached once; a morph target is a Platonic solid's
 *   face-plane set, sampled to a per-vertex TARGET POINT — the radial hit
 *   `d · r(d)`, snapped onto the solid's edge/corner when it lands within
 *   a triangle's width of one (platonic.ts `projectToSolid`; without the
 *   snap the triangles straddling an edge draw a sawtooth band). A change
 *   of form is an ASSEMBLY WAVE (owner, 2026-08-18: "조립되듯이 / 스르륵",
 *   never a snap): every vertex eases from where it is to where it is
 *   going, but each starts on its own beat — a wave sweeps across the body
 *   along a random axis, so the new form assembles from one side to the
 *   other over ~1.4s. Sphere → solid, solid → next solid, solid → sphere
 *   all go through the same wave. Positions are written on the CPU
 *   (≈2.5k vertices) and normals recomputed; one geometry, no topology
 *   tricks.
 * - idle life (§4c): breath, skin noise, drift, gaze, blink — all layered.
 * - states (§4d): listening / thinking / speaking / settled modulate or
 *   trigger the layers; prefers-reduced-motion drops every continuous
 *   layer and turns state changes into short linear steps.
 *
 * Client-only: mount through `SemBodyLazy` (next/dynamic, ssr: false).
 * One instance per page, ever — the host is responsible for that rule.
 */

/** Which pointer-lean the creature adopts while listening: down and a
 *  touch right, toward the composer that sits under it. */
const LISTEN_LEAN = { x: 0.15, y: 1 }

const DEG = Math.PI / 180

/**
 * The canvas is drawn larger than the creature's layout box and centred on
 * it: the sphere (radius 1) spans exactly `size` px, and the overscan is
 * room for a held solid — the tetrahedron's corners reach 2.1× the sphere
 * radius, plus the 8% spring overshoot and breath. Without it a stamped
 * solid clips at the canvas edge. The canvas takes no pointer events (it
 * would otherwise cover neighbours); the wrapper box does.
 */
const OVERSCAN = 2.4

/** Idle-layer calibration — the numbers the brief fixes, kept in one place
 *  so tuning stays a matter of amplitudes, never of adding effects. */
const CAL = {
  breathAmp: 0.025, // scale 1.000 → 1.025
  breathPeriod: 5, // seconds
  // Brief: amplitude 0.03 / frequency 1.2. Pulled to 0.02 / 1.0 after the
  // owner's device review (2026-08-18): at 0.03 the silhouette read as a
  // lumpy shape rather than a breathing skin. Amplitude is the only knob.
  skinAmp: 0.02,
  skinFreq: 1.0,
  skinTimeScale: 0.15,
  driftDegPerSec: 3, // ≤ 4°/s, the least noticeable layer
  gazeMaxDeg: 12,
  gazeLerp: 0.06,
  blinkMinGap: 7,
  blinkMaxGap: 13,
  blinkDuration: 0.12,
  blinkScaleY: 0.94,
  morphHoldMin: 1.6,
  morphHoldMax: 2.6,
  morphInDuration: 1.4,
  morphOutDuration: 1.2,
  /** How much of the transition is spread across the body as a wave:
   *  0 = every vertex moves together, 1 = the last vertex starts when the
   *  first has finished. */
  morphSpread: 0.55,
  tumbleDegPerSec: 18,
  thinkDriftMul: 2.5,
  thinkMorphAmp: 0.12,
  thinkMorphHz: 1.2,
  listenSkinMul: 1.8,
  pulseDuration: 0.3,
  pulsePeak: 1.06,
  punchDuration: 0.12,
  punchScale: 0.96,
  settledHold: 1.2,
} as const

export interface SemBodyProps {
  state: SemState
  /** Rendered square size in CSS px. */
  size: number
  className?: string
  /** Fires on tap/click (the host may answer with a line of copy). */
  onPoke?: () => void
  /** Whether a click/tap morphs the creature into a solid. Default true. */
  interactive?: boolean
}

function readAccent(): string {
  const value = getComputedStyle(document.documentElement)
    .getPropertyValue('--sem-accent')
    .trim()
  return value || '#d6482a'
}

interface Rig {
  renderer: THREE.WebGLRenderer
  scene: THREE.Scene
  camera: THREE.PerspectiveCamera
  gaze: THREE.Group
  mesh: THREE.Mesh<THREE.BufferGeometry, THREE.MeshStandardMaterial>
  positions: THREE.BufferAttribute
  dirs: Float32Array
  /** Per-vertex destination point (x, y, z) of the current transition. */
  target: Float32Array
  /** Per-vertex origin point of the current transition (a snapshot). */
  from: Float32Array
  /** Per-vertex form as of the last frame (skin excluded). */
  form: Float32Array
  /** Per-vertex wave phase in [0, 1] for the current transition. */
  wave: Float32Array
  vertexCount: number
  noise: SimplexNoise3D
  driftAxis: THREE.Vector3
  driftQuat: THREE.Quaternion
  render(): void
  dispose(): void
}

function buildRig(canvas: HTMLCanvasElement, size: number): Rig {
  const renderer = new THREE.WebGLRenderer({
    canvas,
    alpha: true,
    antialias: true,
    powerPreference: 'low-power',
  })
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2))
  renderer.setSize(size * OVERSCAN, size * OVERSCAN, false)
  renderer.setClearColor(0x000000, 0)

  const scene = new THREE.Scene()
  const camera = new THREE.PerspectiveCamera(30, 1, 0.1, 40)
  // Visible half-extent at z=0 equals OVERSCAN, so a unit sphere spans
  // 1/OVERSCAN of the canvas — i.e. exactly the layout box.
  camera.position.set(0, 0, OVERSCAN / Math.tan((30 / 2) * DEG))
  camera.lookAt(0, 0, 0)

  // Paper-white sky, ink ground; one dim key from upper-left. The brief's
  // 1.1 / 0.4 are legacy-light units; three's physically-correct pipeline
  // (the default since r155) folds a 1/π into the Lambert BRDF, so the same
  // look needs the intensities multiplied by π — otherwise the vermilion
  // reads as a dark brown, not as ink.
  const hemi = new THREE.HemisphereLight(0xf7f5f1, 0x1c1a17, 1.1 * Math.PI)
  scene.add(hemi)
  const key = new THREE.DirectionalLight(0xffffff, 0.4 * Math.PI)
  key.position.set(-2.5, 3, 4)
  scene.add(key)

  // Icosphere, merged so every direction is one vertex — the per-frame CPU
  // write touches each exactly once. The brief's "IcosahedronGeometry(1, 4),
  // ≈2.5k verts" is the RECURSIVELY subdivided icosphere (4 halvings: 5,120
  // faces / 2,562 vertices); three's `detail` is linear (each edge split
  // into detail+1), so detail 15 is the geometry that actually has those
  // counts — detail 4 in three's units is a 500-face ball whose edge bands
  // read as ragged, not razor-crisp.
  const raw = new THREE.IcosahedronGeometry(1, 15)
  const geometry = mergeVertices(raw, 1e-4)
  raw.dispose()
  const positions = geometry.getAttribute('position') as THREE.BufferAttribute
  positions.setUsage(THREE.DynamicDrawUsage)
  const vertexCount = positions.count
  const dirs = new Float32Array(vertexCount * 3)
  for (let i = 0; i < vertexCount; i++) {
    const x = positions.getX(i)
    const y = positions.getY(i)
    const z = positions.getZ(i)
    const len = Math.hypot(x, y, z) || 1
    dirs[i * 3] = x / len
    dirs[i * 3 + 1] = y / len
    dirs[i * 3 + 2] = z / len
  }
  const target = new Float32Array(dirs)
  const from = new Float32Array(dirs)
  const form = new Float32Array(dirs)
  const wave = new Float32Array(vertexCount)

  const material = new THREE.MeshStandardMaterial({
    color: new THREE.Color(readAccent()),
    roughness: 0.85,
    metalness: 0,
    flatShading: true,
  })
  const mesh = new THREE.Mesh(geometry, material)
  const gaze = new THREE.Group()
  gaze.add(mesh)
  scene.add(gaze)

  // A tilted, non-vertical drift axis — never a turntable.
  const driftAxis = new THREE.Vector3(0.35, 1, 0.22).normalize()

  return {
    renderer,
    scene,
    camera,
    gaze,
    mesh,
    positions,
    dirs,
    target,
    from,
    form,
    wave,
    vertexCount,
    noise: new SimplexNoise3D(Math.floor(Math.random() * 0x7fffffff)),
    driftAxis,
    driftQuat: new THREE.Quaternion(),
    render() {
      renderer.render(scene, camera)
    },
    dispose() {
      geometry.dispose()
      material.dispose()
      renderer.dispose()
    },
  }
}

/** Point a transition at a solid: sample its surface point along every
 *  cached direction (edge/corner-snapped, see platonic.ts). */
function loadSolidTarget(rig: Rig, solid: SolidId): void {
  const faces = solidFaces(solid)
  const { dirs, target, vertexCount } = rig
  for (let i = 0; i < vertexCount; i++) {
    const p = projectToSolid(faces, [
      dirs[i * 3],
      dirs[i * 3 + 1],
      dirs[i * 3 + 2],
    ])
    target[i * 3] = p[0]
    target[i * 3 + 1] = p[1]
    target[i * 3 + 2] = p[2]
  }
}

/** Point a transition back at the sphere. */
function loadSphereTarget(rig: Rig): void {
  rig.target.set(rig.dirs)
}

/** Begin a transition: the current form becomes the origin, and every
 *  vertex is dealt its beat in the wave — its position along a random
 *  axis, so the new form assembles from one side of the body to the
 *  other (a pinch of noise keeps the front from reading as a ruler). */
function beginWave(rig: Rig): void {
  const { dirs, from, form, wave, vertexCount, noise } = rig
  from.set(form)
  const ax = Math.random() * 2 - 1
  const ay = Math.random() * 2 - 1
  const az = Math.random() * 2 - 1
  const len = Math.hypot(ax, ay, az) || 1
  const seed = Math.random() * 100
  for (let i = 0; i < vertexCount; i++) {
    const dx = dirs[i * 3]
    const dy = dirs[i * 3 + 1]
    const dz = dirs[i * 3 + 2]
    const along = (dx * ax + dy * ay + dz * az) / len // -1..1
    const jitter = noise.noise(dx * 2 + seed, dy * 2, dz * 2) * 0.12
    wave[i] = Math.min(1, Math.max(0, (along + 1) / 2 + jitter))
  }
}

function smoothstep(t: number): number {
  const x = Math.min(1, Math.max(0, t))
  return x * x * (3 - 2 * x)
}

/**
 * Write this frame's surface. `t` is the transition's global progress
 * (0 → 1); each vertex's own progress is `t` stretched by its wave phase
 * (`spread` = 0 collapses to a plain lerp), eased with smoothstep. The
 * resulting form is remembered (`rig.form`) so the next transition can
 * start from it; skin noise along the sphere normal is layered on top,
 * fading out as `solidity` (0 = sphere, 1 = a stamped solid) rises.
 */
function writeSurface(
  rig: Rig,
  t: number,
  spread: number,
  solidity: number,
  skinAmp: number,
  noiseTime: number,
): void {
  const { dirs, from, target, form, wave, positions, vertexCount, noise } = rig
  const arr = positions.array as Float32Array
  const skin = skinAmp * (1 - solidity)
  for (let i = 0; i < vertexCount; i++) {
    const p = spread > 0 ? smoothstep((t * (1 + spread) - wave[i] * spread)) : t
    const fx = from[i * 3] + (target[i * 3] - from[i * 3]) * p
    const fy = from[i * 3 + 1] + (target[i * 3 + 1] - from[i * 3 + 1]) * p
    const fz = from[i * 3 + 2] + (target[i * 3 + 2] - from[i * 3 + 2]) * p
    form[i * 3] = fx
    form[i * 3 + 1] = fy
    form[i * 3 + 2] = fz
    let n = 0
    if (skin > 0) {
      const dx = dirs[i * 3]
      const dy = dirs[i * 3 + 1]
      const dz = dirs[i * 3 + 2]
      n =
        skin *
        noise.noise(
          dx * CAL.skinFreq + noiseTime,
          dy * CAL.skinFreq - noiseTime * 0.7,
          dz * CAL.skinFreq + noiseTime * 0.4,
        )
    }
    arr[i * 3] = fx + dirs[i * 3] * n
    arr[i * 3 + 1] = fy + dirs[i * 3 + 1] * n
    arr[i * 3 + 2] = fz + dirs[i * 3 + 2] * n
  }
  positions.needsUpdate = true
  rig.mesh.geometry.computeVertexNormals()
}

export function SemBody({
  state,
  size,
  className,
  onPoke,
  interactive = true,
}: SemBodyProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const boxRef = useRef<HTMLDivElement>(null)
  const stateRef = useRef<SemState>(state)
  const onPokeRef = useRef(onPoke)
  useEffect(() => {
    onPokeRef.current = onPoke
  }, [onPoke])
  // Imperative handles the effect below fills in, so React-side changes
  // (state prop, size prop) reach the running loop without a remount.
  const apiRef = useRef<{
    setState(next: SemState): void
    resize(size: number): void
    poke(): void
  } | null>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    const box = boxRef.current
    if (!canvas || !box) return
    const rig = buildRig(canvas, size)
    const reduceMotion = window.matchMedia(
      '(prefers-reduced-motion: reduce)',
    ).matches

    // ---- animation state ------------------------------------------------
    let time = 0
    let noiseTime = 0
    let last: number | null = null
    let raf = 0
    let paused = false
    let dirty = true

    // Morph choreography: a transition ('in' toward a solid, 'out' back to
    // the sphere) runs its wave over a fixed duration; 'hold' keeps the
    // solid, measured from the moment it has fully formed.
    let morphPhase: 'none' | 'in' | 'hold' | 'out' = 'none'
    let transStart = 0
    let transDuration = 1
    let transT = 0
    let holdDuration = 0
    let holdUntil = 0
    let currentSolid: SolidId | null = null
    // Thinking oscillation: a small breath toward a solid, no wave.
    let thinkTargetLoaded = false

    // Scale beats.
    let pulseStart = -1
    let punchStart = -1
    // Blink.
    let nextBlink = CAL.blinkMinGap + Math.random() * (CAL.blinkMaxGap - CAL.blinkMinGap)
    let blinkStart = -1
    // Gaze.
    const gazeTarget = { x: 0, y: 0 } // -1..1 in screen space
    let pointerSeen = false
    // Reduced-motion state step (200ms opacity/scale).
    let stepStart = -1

    /** Assemble into `solid` (from wherever the body is now), hold, relax. */
    const startMorph = (solid: SolidId, hold: number) => {
      currentSolid = solid
      thinkTargetLoaded = false
      beginWave(rig)
      loadSolidTarget(rig, solid)
      morphPhase = 'in'
      transStart = time
      transDuration = reduceMotion ? 0.3 : CAL.morphInDuration
      transT = 0
      holdDuration = hold
      dirty = true
    }

    const poke = () => {
      if (!interactive) return
      const hold =
        CAL.morphHoldMin + Math.random() * (CAL.morphHoldMax - CAL.morphHoldMin)
      startMorph(pickNextSolid(currentSolid), hold)
      punchStart = time
      onPokeRef.current?.()
    }

    // ---- per-frame -----------------------------------------------------
    const frame = (dt: number) => {
      const s = stateRef.current
      time += dt

      // Form: where the transition stands, and how solid the body is.
      let spread = reduceMotion ? 0 : CAL.morphSpread
      let solidity = 0
      if (morphPhase === 'in') {
        transT = Math.min(1, (time - transStart) / transDuration)
        solidity = transT
        if (transT >= 1) {
          morphPhase = 'hold'
          holdUntil = time + holdDuration
        }
      } else if (morphPhase === 'hold') {
        transT = 1
        solidity = 1
        if (time >= holdUntil) {
          // Relax: the solid melts back into the sphere, same wave.
          beginWave(rig)
          loadSphereTarget(rig)
          morphPhase = 'out'
          transStart = time
          transDuration = reduceMotion ? 0.3 : CAL.morphOutDuration
          transT = 0
        }
      } else if (morphPhase === 'out') {
        transT = Math.min(1, (time - transStart) / transDuration)
        solidity = 1 - transT
        if (transT >= 1) {
          morphPhase = 'none'
          transT = 1
        }
      } else if (s === 'thinking' && !reduceMotion) {
        // Visibly working, still a sphere: a small breath toward a solid,
        // 0 ↔ 0.12 at 1.2 Hz, no wave.
        if (!thinkTargetLoaded) {
          rig.from.set(rig.dirs)
          loadSolidTarget(rig, pickNextSolid(currentSolid))
          thinkTargetLoaded = true
        }
        spread = 0
        transT =
          (CAL.thinkMorphAmp / 2) *
          (1 - Math.cos(2 * Math.PI * CAL.thinkMorphHz * time))
        solidity = 0
      } else {
        // At rest: the sphere. (After a relax the target IS the sphere and
        // transT is 1, so this is a no-op blend either way.)
        if (thinkTargetLoaded) {
          rig.from.set(rig.dirs)
          loadSphereTarget(rig)
          thinkTargetLoaded = false
        }
        spread = 0
        transT = 1
        solidity = 0
      }

      // Continuous layers (none under reduced motion).
      let breath = 1
      let scaleY = 1
      let skinAmp = 0
      if (!reduceMotion) {
        breath =
          1 +
          (CAL.breathAmp / 2) *
            (1 - Math.cos((2 * Math.PI * time) / CAL.breathPeriod))
        skinAmp = CAL.skinAmp * (s === 'listening' ? CAL.listenSkinMul : 1)
        noiseTime += dt * CAL.skinTimeScale

        // Drift: slow rotation on the tilted axis; ×2.5 while thinking;
        // a slow tumble while a solid is held.
        let degPerSec: number = CAL.driftDegPerSec
        if (s === 'thinking') degPerSec *= CAL.thinkDriftMul
        if (morphPhase === 'hold' || morphPhase === 'in') degPerSec = CAL.tumbleDegPerSec
        rig.driftQuat.setFromAxisAngle(rig.driftAxis, degPerSec * DEG * dt)
        rig.mesh.quaternion.premultiply(rig.driftQuat)

        // Blink: a 120ms squash every 7–13s.
        if (blinkStart < 0 && time >= nextBlink) {
          blinkStart = time
          nextBlink =
            time +
            CAL.blinkMinGap +
            Math.random() * (CAL.blinkMaxGap - CAL.blinkMinGap)
        }
        if (blinkStart >= 0) {
          const t = (time - blinkStart) / CAL.blinkDuration
          if (t >= 1) {
            blinkStart = -1
          } else {
            scaleY = 1 - (1 - CAL.blinkScaleY) * Math.sin(Math.PI * t)
          }
        }
      }

      // Gaze: lean toward the pointer (or the composer while listening),
      // approached with a 0.06 lerp so it trails like attention.
      const lean =
        s === 'listening'
          ? LISTEN_LEAN
          : pointerSeen
            ? gazeTarget
            : { x: 0, y: 0 }
      const targetRx = lean.y * CAL.gazeMaxDeg * DEG
      const targetRy = lean.x * CAL.gazeMaxDeg * DEG
      if (reduceMotion) {
        rig.gaze.rotation.x = targetRx
        rig.gaze.rotation.y = targetRy
      } else {
        rig.gaze.rotation.x += (targetRx - rig.gaze.rotation.x) * CAL.gazeLerp
        rig.gaze.rotation.y += (targetRy - rig.gaze.rotation.y) * CAL.gazeLerp
      }

      // Scale beats: speaking pulse and tap punch.
      let beat = 1
      if (pulseStart >= 0) {
        const t = (time - pulseStart) / CAL.pulseDuration
        if (t >= 1) pulseStart = -1
        else beat *= 1 + (CAL.pulsePeak - 1) * Math.sin(Math.PI * t)
      }
      if (punchStart >= 0) {
        const t = (time - punchStart) / CAL.punchDuration
        if (t >= 1) punchStart = -1
        else beat *= CAL.punchScale + (1 - CAL.punchScale) * t
      }
      // Reduced motion: a state change is a 200ms scale/opacity step.
      let opacity = 1
      if (reduceMotion && stepStart >= 0) {
        const t = (time - stepStart) / 0.2
        if (t >= 1) stepStart = -1
        else {
          beat *= 0.97 + 0.03 * t
          opacity = 0.85 + 0.15 * t
        }
      }
      rig.mesh.material.opacity = opacity
      rig.mesh.material.transparent = opacity < 1

      const scale = breath * beat
      rig.mesh.scale.set(scale, scale * scaleY, scale)

      writeSurface(rig, transT, spread, solidity, skinAmp, noiseTime)
      rig.render()

      // Under reduced motion the loop only runs while something is in
      // flight; otherwise it is continuous (paused offscreen/hidden).
      const inFlight =
        morphPhase !== 'none' ||
        pulseStart >= 0 ||
        punchStart >= 0 ||
        stepStart >= 0
      dirty = !reduceMotion || inFlight
    }

    const tick = (now: number) => {
      raf = 0
      if (paused) return
      const dt = last === null ? 1 / 60 : Math.min(0.1, (now - last) / 1000)
      last = now
      frame(dt)
      if (dirty) raf = requestAnimationFrame(tick)
      else last = null
    }
    const wake = () => {
      dirty = true
      if (!paused && raf === 0) raf = requestAnimationFrame(tick)
    }

    // ---- pause when hidden / offscreen ----------------------------------
    let tabHidden = document.visibilityState === 'hidden'
    let offscreen = false
    const applyPause = () => {
      const next = tabHidden || offscreen
      if (next === paused) return
      paused = next
      if (paused) {
        if (raf) cancelAnimationFrame(raf)
        raf = 0
        last = null
      } else {
        wake()
      }
    }
    const onVisibility = () => {
      tabHidden = document.visibilityState === 'hidden'
      applyPause()
    }
    document.addEventListener('visibilitychange', onVisibility)
    const io = new IntersectionObserver(
      ([entry]) => {
        offscreen = !entry.isIntersecting
        applyPause()
      },
      { threshold: 0 },
    )
    io.observe(box)

    // ---- pointer: gaze + poke -------------------------------------------
    const onPointerMove = (event: PointerEvent) => {
      const rect = box.getBoundingClientRect()
      const cx = rect.left + rect.width / 2
      const cy = rect.top + rect.height / 2
      const halfW = Math.max(1, window.innerWidth / 2)
      const halfH = Math.max(1, window.innerHeight / 2)
      gazeTarget.x = Math.max(-1, Math.min(1, (event.clientX - cx) / halfW))
      gazeTarget.y = Math.max(-1, Math.min(1, (event.clientY - cy) / halfH))
      pointerSeen = true
      if (reduceMotion) wake()
    }
    window.addEventListener('pointermove', onPointerMove, { passive: true })
    const onPointerDown = (event: PointerEvent) => {
      event.preventDefault()
      poke()
      wake()
    }
    box.addEventListener('pointerdown', onPointerDown)

    // ---- theme: re-read the accent when the theme flips -----------------
    const recolor = () => {
      rig.mesh.material.color.set(readAccent())
      wake()
    }
    const mo = new MutationObserver(recolor)
    mo.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['data-theme', 'class'],
    })
    const scheme = window.matchMedia('(prefers-color-scheme: dark)')
    scheme.addEventListener('change', recolor)

    // ---- imperative API for prop changes --------------------------------
    apiRef.current = {
      setState(next) {
        const prev = stateRef.current
        stateRef.current = next
        if (next === prev) return
        if (reduceMotion) stepStart = time
        if (next === 'speaking') pulseStart = time
        if (next === 'settled') startMorph(pickNextSolid(currentSolid), CAL.settledHold)
        wake()
      },
      resize(next) {
        rig.renderer.setSize(next * OVERSCAN, next * OVERSCAN, false)
        wake()
      },
      poke,
    }

    // First frame(s).
    wake()

    return () => {
      apiRef.current = null
      if (raf) cancelAnimationFrame(raf)
      document.removeEventListener('visibilitychange', onVisibility)
      io.disconnect()
      window.removeEventListener('pointermove', onPointerMove)
      box.removeEventListener('pointerdown', onPointerDown)
      mo.disconnect()
      scheme.removeEventListener('change', recolor)
      rig.dispose()
    }
    // The rig is built once per mount; state/size flow through apiRef.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [interactive])

  useEffect(() => {
    apiRef.current?.setState(state)
  }, [state])

  useEffect(() => {
    apiRef.current?.resize(size)
  }, [size])

  const overscanPx = size * OVERSCAN
  const offset = -(overscanPx - size) / 2
  return (
    <div
      ref={boxRef}
      aria-hidden="true"
      data-testid="sem-body"
      data-sem-state={state}
      className={className}
      style={{
        position: 'relative',
        width: size,
        height: size,
        touchAction: 'manipulation',
        cursor: interactive ? 'pointer' : undefined,
      }}
    >
      <canvas
        ref={canvasRef}
        style={{
          position: 'absolute',
          left: offset,
          top: offset,
          width: overscanPx,
          height: overscanPx,
          display: 'block',
          pointerEvents: 'none',
        }}
      />
    </div>
  )
}
