/**
 * Sem particle engine — the animated ink-dot mark of the in-chat
 * assistant (docs/BRAND.md §3–4). Round 3 (owner, 2026-08-14): ONE living
 * body, not a swarm.
 *
 * Model: every dot lives on the surface of a small body — a sphere by
 * default, a polyhedron while thinking, a nucleus-and-shell form now and
 * then — and the WHOLE body turns as one, breathes as one, flinches as
 * one. Nearest neighbours are joined by a thin wireframe so the eye reads
 * a globe, not loose points. Individual dots only "twitch" now and then
 * (a few hop at once, briskly, then hold still), so the personality is a
 * creature's, not a gnat cloud's. Each state is a fixed choreography (the
 * Siri-orb principle: a state has a motion, not a random walk):
 *
 *   idle       slow turn, breathing, rare twitches / glances / form swaps
 *   listening  leans in, nearly still, quick shallow breathing
 *   thinking   polyhedra cycling (ico → octa → cube → tetra…), fast turn
 *   speaking   radius pulses with a ripple running down the body
 *   settled    dots lock to the flat dot-matrix glyph, mesh off
 *
 * Pure canvas-2D; the host (SemMark) applies the goo filter to the ink
 * canvas. Wireframe + accent dot are painted on the second, unfiltered
 * canvas so they stay crisp.
 */

export const SEM_STATES = [
  "idle",
  "listening",
  "thinking",
  "speaking",
  "settled",
] as const;

export type SemState = (typeof SEM_STATES)[number];

export interface SemEngineOptions {
  /** Group member count (big dots = members + the accent dot). */
  members: number;
  /** Small dots between the big ones; 0 at avatar sizes. */
  flowDots: number;
  /** Ink color for the black layer (and the wireframe). */
  ink: string;
  /** Accent color for Sem's own dot. */
  accent: string;
  /** When false the accent dot is painted as ink (pure two-tone). */
  accentOn: boolean;
  /** Radius multiplier for tiny canvases. */
  dotScale?: number;
}

interface Dot {
  /** Position / velocity in BODY frame (rotates as one). */
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  /** Spring target in body frame. */
  tx: number;
  ty: number;
  tz: number;
  /** Screen-plane lean (pointer play), unit space. */
  lx: number;
  ly: number;
  lvx: number;
  lvy: number;
  r: number;
  p1: number;
  slot: number;
  big: boolean;
  accent: boolean;
}

interface Edge {
  a: number;
  b: number;
  w: number;
  target: number;
}

type RegularForm = "ico" | "octa" | "cube" | "tetra";
/** `irr:<n>` = one of the seeded IRREGULAR polyhedra (owner, round 3b:
 *  regular solids alone read too symmetric — most swaps should land on
 *  a lopsided n-hedron). */
type Form = "sphere" | "nucleus" | RegularForm | `irr:${number}`;
const IRREGULAR_COUNT = 12;

/** Perspective: dots at z=+1 grow, z=-1 shrink. */
const FOCAL = 2.4;
const BODY_R = 0.74;

const STIFFNESS: Record<SemState, number> = {
  idle: 40,
  listening: 30,
  thinking: 46,
  speaking: 34,
  settled: 42,
};

const DAMPING: Record<SemState, number> = {
  idle: 8.5,
  listening: 7,
  thinking: 8,
  speaking: 6.5,
  settled: 8.5,
};

function mulberry(seed: number): () => number {
  let t = seed >>> 0;
  return () => {
    t += 0x6d2b79f5;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r = (r + Math.imul(r ^ (r >>> 7), 61 | r)) ^ r;
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

type V3 = [number, number, number];

function norm(v: V3): V3 {
  const l = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / l, v[1] / l, v[2] / l];
}

const PHI = (1 + Math.sqrt(5)) / 2;
const POLY: Record<RegularForm, V3[]> = {
  tetra: [
    [1, 1, 1],
    [1, -1, -1],
    [-1, 1, -1],
    [-1, -1, 1],
  ].map((v) => norm(v as V3)),
  octa: [
    [1, 0, 0],
    [-1, 0, 0],
    [0, 1, 0],
    [0, -1, 0],
    [0, 0, 1],
    [0, 0, -1],
  ],
  cube: [
    [1, 1, 1],
    [1, 1, -1],
    [1, -1, 1],
    [1, -1, -1],
    [-1, 1, 1],
    [-1, 1, -1],
    [-1, -1, 1],
    [-1, -1, -1],
  ].map((v) => norm(v as V3)),
  ico: [
    [0, 1, PHI],
    [0, -1, PHI],
    [0, 1, -PHI],
    [0, -1, -PHI],
    [1, PHI, 0],
    [-1, PHI, 0],
    [1, -PHI, 0],
    [-1, -PHI, 0],
    [PHI, 0, 1],
    [-PHI, 0, 1],
    [PHI, 0, -1],
    [-PHI, 0, -1],
  ].map((v) => norm(v as V3)),
};

/** Edge midpoints of a regular polyhedron (pairs at the minimum spacing). */
function polyMidpoints(verts: V3[]): V3[] {
  let min = Infinity;
  for (let i = 0; i < verts.length; i++)
    for (let j = i + 1; j < verts.length; j++) {
      const d = Math.hypot(
        verts[i][0] - verts[j][0],
        verts[i][1] - verts[j][1],
        verts[i][2] - verts[j][2],
      );
      if (d < min) min = d;
    }
  const mids: V3[] = [];
  for (let i = 0; i < verts.length; i++)
    for (let j = i + 1; j < verts.length; j++) {
      const d = Math.hypot(
        verts[i][0] - verts[j][0],
        verts[i][1] - verts[j][1],
        verts[i][2] - verts[j][2],
      );
      if (d < min * 1.05)
        mids.push(
          norm([
            (verts[i][0] + verts[j][0]) / 2,
            (verts[i][1] + verts[j][1]) / 2,
            (verts[i][2] + verts[j][2]) / 2,
          ]),
        );
    }
  return mids;
}

/** Evenly spread directions on a sphere (Fibonacci lattice). */
function fibSphere(n: number): V3[] {
  const out: V3[] = [];
  const ga = Math.PI * (3 - Math.sqrt(5));
  for (let i = 0; i < n; i++) {
    const y = n === 1 ? 0 : 1 - (2 * (i + 0.5)) / n;
    const rr = Math.sqrt(Math.max(0, 1 - y * y));
    const a = ga * i;
    out.push([Math.cos(a) * rr, y, Math.sin(a) * rr]);
  }
  return out;
}

/**
 * A lopsided convex-ish n-hedron: n well-separated random directions with
 * jittered radii. Seeded, so the same body always owns the same shapes.
 */
function irregularPoly(rand: () => number): V3[] {
  const n = 5 + Math.floor(rand() * 7); // 5..11 vertices
  const verts: V3[] = [];
  let guard = 0;
  while (verts.length < n && guard++ < 400) {
    const v = norm([rand() * 2 - 1, rand() * 2 - 1, rand() * 2 - 1]);
    const tooClose = verts.some(
      (u) => u[0] * v[0] + u[1] * v[1] + u[2] * v[2] > 0.72,
    );
    if (tooClose) continue;
    const r = 0.8 + rand() * 0.35;
    verts.push([v[0] * r, v[1] * r, v[2] * r]);
  }
  return verts;
}

/**
 * The settled glyph, mark-5152 lineage (docs/BRAND.md §3): a dot-matrix
 * cross — big core dots at the center, small satellites tapering out the
 * four arms.
 */
export function glyphSlots(
  bigCount: number,
  smallCount: number,
): Array<{ x: number; y: number; r: number }> {
  const slots: Array<{ x: number; y: number; r: number }> = [];
  const step = 0.34;
  const bigSpots = [
    [0, 0],
    [0, -step],
    [step, 0],
    [0, step],
    [-step, 0],
    [step, -step],
    [-step, step],
    [step, step],
    [-step, -step],
  ];
  for (let i = 0; i < bigCount; i++) {
    const [x, y] = bigSpots[Math.min(i, bigSpots.length - 1)];
    slots.push({ x, y, r: 0.155 });
  }
  const arms = [
    [0, -1],
    [1, 0],
    [0, 1],
    [-1, 0],
  ];
  let ring = 2;
  let armIx = 0;
  for (let i = 0; i < smallCount; i++) {
    const [ax, ay] = arms[armIx];
    const r = ring === 2 ? 0.085 : 0.05;
    slots.push({ x: ax * step * ring, y: ay * step * ring, r });
    armIx = (armIx + 1) % arms.length;
    if (armIx === 0) ring = ring === 2 ? 3 : 2;
  }
  return slots;
}

export class SemEngine {
  private dots: Dot[] = [];
  private edges: Edge[] = [];
  /** Host-requested state; `state` is what actually plays (a poke can
   *  override it with a short think→speak act, see `poke`). */
  private baseState: SemState = "idle";
  private state: SemState = "idle";
  private act: Array<{ state: SemState; until: number }> = [];
  private form: Form = "sphere";
  private irregular: V3[][] = [];
  private raf = 0;
  private last = 0;
  private time = 0;
  /** Body rotation about Y (accumulated) and its angular velocity. */
  private rot = 0;
  private rotVel = 0.28;
  /** Camera tilt about X — lifts the pole into view; leans in listening. */
  private tilt = 0.42;
  /** Body-level breathing/flinch scale (spring). */
  private squeeze = 0;
  private squeezeVel = 0;
  /** "Look at the pointer" bias, eased. */
  private lookX = 0;
  private lookY = 0;
  /** Timers for the choreography events. */
  private twitchClock = 0;
  private formClock = 0;
  private glanceClock = 0;
  private pointer: { x: number; y: number } | null = null;
  private inkCtx: CanvasRenderingContext2D | null = null;
  private crispCtx: CanvasRenderingContext2D | null = null;
  private size = 0;
  private dpr = 1;
  private opts: SemEngineOptions;
  private rand: () => number;
  /** Offscreen field for the metaball goo (see draw()). */
  private field: HTMLCanvasElement | OffscreenCanvas | null = null;
  private fieldCtx:
    | CanvasRenderingContext2D
    | OffscreenCanvasRenderingContext2D
    | null = null;
  private perm: number[] = [];

  constructor(opts: SemEngineOptions, seed = 20260814) {
    this.opts = opts;
    this.rand = mulberry(seed);
    for (let i = 0; i < IRREGULAR_COUNT; i++) this.irregular.push(irregularPoly(this.rand));
    this.buildDots();
  }

  private buildDots() {
    const { members, flowDots } = this.opts;
    const bigCount = Math.min(members, 5) + 1;
    this.dots = [];
    for (let i = 0; i < bigCount; i++) this.dots.push(this.makeDot(true, i === 0));
    for (let i = 0; i < flowDots; i++) this.dots.push(this.makeDot(false, false));
    this.dots.forEach((d, i) => (d.slot = i));
    // Stable shuffle: bigs and smalls interleave over the surface instead
    // of the bigs clumping at one pole of the lattice.
    this.perm = this.dots.map((_, i) => i);
    for (let i = this.perm.length - 1; i > 0; i--) {
      const j = Math.floor(this.rand() * (i + 1));
      [this.perm[i], this.perm[j]] = [this.perm[j], this.perm[i]];
    }
    this.form = "sphere";
    this.retarget();
    for (const d of this.dots) {
      d.x = d.tx;
      d.y = d.ty;
      d.z = d.tz;
    }
    this.rebuildEdges();
    for (const e of this.edges) e.w = e.target;
  }

  private makeDot(big: boolean, accent: boolean): Dot {
    return {
      x: 0,
      y: 0,
      z: 0,
      vx: 0,
      vy: 0,
      vz: 0,
      tx: 0,
      ty: 0,
      tz: 0,
      lx: 0,
      ly: 0,
      lvx: 0,
      lvy: 0,
      r: (big ? 0.15 : 0.055 + this.rand() * 0.03) * (this.opts.dotScale ?? 1),
      p1: this.rand() * Math.PI * 2,
      slot: 0,
      big,
      accent,
    };
  }

  setState(next: SemState) {
    this.baseState = next;
    if (this.act.length > 0) return; // an act is playing; it resumes into `next`
    this.applyState(next);
  }

  private applyState(next: SemState) {
    if (next === this.state) return;
    this.state = next;
    this.twitchClock = 0;
    this.formClock = 0;
    if (next === "thinking") {
      // A fresh random shape every time thinking starts (owner: every
      // tap used to show the same icosahedron).
      this.form = "sphere";
      this.nextForm();
      return;
    }
    this.form = "sphere";
    this.retarget();
    if (next === "settled") {
      for (const e of this.edges) e.target = 0;
    } else {
      this.rebuildEdges();
    }
  }

  getState(): SemState {
    return this.state;
  }

  setMembers(members: number) {
    if (members === this.opts.members) return;
    this.opts = { ...this.opts, members };
    this.buildDots();
  }

  setAccent(accentOn: boolean, accent?: string) {
    this.opts = { ...this.opts, accentOn, accent: accent ?? this.opts.accent };
  }

  /** Pointer position in unit space while hovering, else null. */
  setPointer(p: { x: number; y: number } | null) {
    this.pointer = p;
  }

  /**
   * A tap: the body flinches as one (squeeze + a turn), the dots under the
   * finger scatter in the screen plane, and a form swap follows shortly.
   */
  poke(x = 0, y = 0) {
    // The act: a beat of thinking, then "saying" the line the host shows,
    // then back to whatever the host asked for.
    if (this.state !== "settled") {
      this.act = [
        { state: "thinking", until: this.time + 0.9 },
        { state: "speaking", until: this.time + 2.6 },
      ];
      this.applyState("thinking");
      // A second shape lands mid-act, so the beat visibly "works".
      this.formClock = this.formPeriod() - 0.45;
    }
    this.squeezeVel -= 2.4;
    this.rotVel += (this.rand() < 0.5 ? -1 : 1) * 2.2;
    for (const d of this.dots) {
      const [px, py] = this.screenUnit(d);
      const dx = px - x;
      const dy = py - y;
      const dist = Math.hypot(dx, dy) + 0.05;
      if (dist > 0.75) continue;
      const kick = 1.6 * (1 - dist / 0.75);
      d.lvx += (dx / dist) * kick;
      d.lvy += (dy / dist) * kick;
    }
    this.formClock = Math.max(this.formClock, this.formPeriod() - 0.35);
  }

  /** Where the surface targets go for the current state + form. */
  private retarget() {
    const dots = this.dots;
    const n = dots.length;
    const st = this.state;
    if (st === "settled") {
      const bigs = dots.filter((d) => d.big);
      const smalls = dots.filter((d) => !d.big);
      const slots = glyphSlots(bigs.length, smalls.length);
      let s = 0;
      for (const d of [...bigs, ...smalls]) {
        const slot = slots[s++];
        d.tx = slot.x;
        d.ty = slot.y;
        d.tz = 0;
      }
      return;
    }
    let dirs: V3[];
    let radiusOf: (d: Dot) => number = () => BODY_R;
    if (this.form === "sphere" || this.form === "nucleus") {
      dirs = fibSphere(n);
      if (this.form === "nucleus") {
        // Bigs sink to an inner core, smalls stay as the shell — a
        // nested body, still one body (same rotation, one mesh).
        radiusOf = (d) => (d.big ? 0.36 : 0.86);
      }
    } else {
      const verts = this.form.startsWith("irr:")
        ? this.irregular[Number(this.form.slice(4)) % this.irregular.length]
        : POLY[this.form as RegularForm];
      const mids = polyMidpoints(verts);
      dirs = [];
      for (let i = 0; i < n; i++) {
        dirs.push(i < verts.length ? verts[i] : mids[(i - verts.length) % mids.length]);
      }
      // Irregular verts carry their own radius jitter; regulars are unit.
      radiusOf = () => BODY_R * 1.02;
    }
    for (let i = 0; i < n; i++) {
      const d = dots[i];
      const v = dirs[this.perm[i] % dirs.length];
      const R = radiusOf(d);
      d.tx = v[0] * R;
      d.ty = v[1] * R;
      d.tz = v[2] * R;
    }
  }

  /** Nearest-neighbour wireframe over the current targets. */
  private rebuildEdges() {
    const n = this.dots.length;
    const next: Edge[] = [];
    const dist2 = (i: number, j: number) => {
      const a = this.dots[i];
      const b = this.dots[j];
      const dx = a.tx - b.tx;
      const dy = a.ty - b.ty;
      const dz = a.tz - b.tz;
      return dx * dx + dy * dy + dz * dz;
    };
    for (let i = 0; i < n; i++) {
      const ds: Array<{ j: number; d: number }> = [];
      for (let j = 0; j < n; j++) if (j !== i) ds.push({ j, d: dist2(i, j) });
      ds.sort((p, q) => p.d - q.d);
      if (ds.length === 0) continue;
      const near = ds[0].d;
      let links = 0;
      for (const { j, d } of ds) {
        if (d > near * 1.9 || links >= 4) break;
        const a = Math.min(i, j);
        const b = Math.max(i, j);
        if (!next.some((e) => e.a === a && e.b === b)) {
          const old = this.edges.find((e) => e.a === a && e.b === b);
          next.push({ a, b, w: old ? old.w : 0, target: 1 });
        }
        links++;
      }
    }
    for (const old of this.edges) {
      if (old.w > 0.05 && !next.some((e) => e.a === old.a && e.b === old.b)) {
        next.push({ ...old, target: 0 });
      }
    }
    this.edges = next;
  }

  private formPeriod(): number {
    return this.state === "thinking" ? 1.4 : 7 + this.rand() * 5;
  }

  /** Cycle the body's shape — the thinking choreography, and a rare idle swap. */
  private nextForm() {
    const irr = (): Form => `irr:${Math.floor(this.rand() * IRREGULAR_COUNT)}`;
    const regular: RegularForm[] = ["ico", "octa", "cube", "tetra"];
    let next: Form = this.form;
    for (let tries = 0; tries < 6 && next === this.form; tries++) {
      if (this.state === "thinking") {
        // Mostly lopsided, sometimes a perfect solid, rarely the sphere.
        const r = this.rand();
        next = r < 0.6 ? irr() : r < 0.9 ? regular[Math.floor(this.rand() * 4)] : "sphere";
      } else {
        // Idle: usually home to the sphere, otherwise a nucleus or a shape.
        const r = this.rand();
        next =
          this.form !== "sphere" ? "sphere" : r < 0.4 ? "nucleus" : r < 0.85 ? irr() : regular[Math.floor(this.rand() * 4)];
      }
    }
    this.form = next;
    this.retarget();
    this.rebuildEdges();
  }

  /** A few dots hop to a neighbouring spot at once — a twitch, not a swarm. */
  private twitch() {
    const count = 2 + Math.floor(this.rand() * 3);
    for (let k = 0; k < count; k++) {
      const d = this.dots[Math.floor(this.rand() * this.dots.length)];
      const R = Math.hypot(d.tx, d.ty, d.tz) || BODY_R;
      const ang = 0.35 + this.rand() * 0.4;
      // Rotate the target direction by `ang` around a random axis.
      const ax = norm([this.rand() - 0.5, this.rand() - 0.5, this.rand() - 0.5]);
      const v = norm([d.tx, d.ty, d.tz]);
      const c = Math.cos(ang);
      const s = Math.sin(ang);
      const dot = ax[0] * v[0] + ax[1] * v[1] + ax[2] * v[2];
      const cross: V3 = [
        ax[1] * v[2] - ax[2] * v[1],
        ax[2] * v[0] - ax[0] * v[2],
        ax[0] * v[1] - ax[1] * v[0],
      ];
      const nv: V3 = [
        v[0] * c + cross[0] * s + ax[0] * dot * (1 - c),
        v[1] * c + cross[1] * s + ax[1] * dot * (1 - c),
        v[2] * c + cross[2] * s + ax[2] * dot * (1 - c),
      ];
      d.tx = nv[0] * R;
      d.ty = nv[1] * R;
      d.tz = nv[2] * R;
    }
    this.rebuildEdges();
  }

  start(ink: HTMLCanvasElement, crisp: HTMLCanvasElement, dpr: number) {
    this.inkCtx = ink.getContext("2d");
    this.crispCtx = crisp.getContext("2d");
    this.size = ink.width;
    this.dpr = dpr;
    this.last = performance.now();
    const loop = (now: number) => {
      const dt = Math.min((now - this.last) / 1000, 1 / 20);
      this.last = now;
      this.update(dt);
      this.draw();
      this.raf = requestAnimationFrame(loop);
    };
    this.raf = requestAnimationFrame(loop);
  }

  stop() {
    cancelAnimationFrame(this.raf);
    this.raf = 0;
  }

  /** Paint a single static settled frame (reduced-motion / frozen). */
  drawStatic(ink: HTMLCanvasElement, crisp: HTMLCanvasElement, dpr: number) {
    this.inkCtx = ink.getContext("2d");
    this.crispCtx = crisp.getContext("2d");
    this.size = ink.width;
    this.dpr = dpr;
    this.setState("settled");
    this.rot = 0;
    this.tilt = 0;
    this.edges = [];
    for (const d of this.dots) {
      d.x = d.tx;
      d.y = d.ty;
      d.z = d.tz;
      d.vx = d.vy = d.vz = 0;
    }
    this.draw();
  }

  private update(dt: number) {
    this.time += dt;
    while (this.act.length > 0 && this.time >= this.act[0].until) {
      this.act.shift();
      this.applyState(this.act.length > 0 ? this.act[0].state : this.baseState);
    }
    const st = this.state;
    const k = STIFFNESS[st];
    const c = DAMPING[st];

    // ---- Body choreography -------------------------------------------
    // Rotation: a slow steady turn (idle), nearly still (listening), brisk
    // (thinking); flat states ease home so the glyph faces the camera.
    const baseVel =
      st === "idle" ? 0.26 : st === "thinking" ? 0.95 : st === "speaking" ? 0.4 : st === "listening" ? 0.08 : 0;
    this.rotVel += (baseVel - this.rotVel) * Math.min(2.2 * dt, 1);
    if (st === "settled") {
      const home = Math.round(this.rot / (Math.PI * 2)) * Math.PI * 2;
      this.rot += (home - this.rot) * Math.min(5 * dt, 1);
    } else {
      this.rot += this.rotVel * dt;
    }
    const tiltTarget =
      st === "settled" ? 0 : st === "listening" ? 0.9 : st === "thinking" ? 0.5 : 0.42 + Math.sin(this.time * 0.35) * 0.1;
    this.tilt += (tiltTarget - this.tilt) * Math.min(2.5 * dt, 1);

    // Look at the pointer: the whole body turns a little toward the cursor.
    const lookTX = this.pointer ? Math.max(-1, Math.min(1, this.pointer.x)) * 0.35 : 0;
    const lookTY = this.pointer ? Math.max(-1, Math.min(1, this.pointer.y)) * 0.3 : 0;
    this.lookX += (lookTX - this.lookX) * Math.min(4 * dt, 1);
    this.lookY += (lookTY - this.lookY) * Math.min(4 * dt, 1);

    // Squeeze spring (flinch on poke; also the speaking pulse driver).
    const sqAcc = -this.squeeze * 60 - this.squeezeVel * 7;
    this.squeezeVel += sqAcc * dt;
    this.squeeze += this.squeezeVel * dt;

    // Events: twitches, glances, form swaps — rare and brisk.
    if (st === "idle" || st === "listening") {
      this.twitchClock += dt;
      if (this.twitchClock > 2.6 + this.rand() * 3.4) {
        this.twitchClock = 0;
        this.twitch();
      }
      this.glanceClock += dt;
      if (st === "idle" && this.glanceClock > 4 + this.rand() * 5) {
        this.glanceClock = 0;
        this.rotVel += (this.rand() < 0.5 ? -1 : 1) * (0.9 + this.rand() * 0.8);
      }
    }
    if (st === "idle" || st === "thinking") {
      this.formClock += dt;
      if (this.formClock > this.formPeriod()) {
        this.formClock = 0;
        this.nextForm();
      }
    }

    // ---- Per-dot springs to the body surface -------------------------
    const breathe =
      st === "listening"
        ? 1 + Math.sin(this.time * 2.4) * 0.02
        : st === "speaking"
          ? 1 + Math.sin(this.time * 5.2) * 0.07 + Math.sin(this.time * 2.1) * 0.03
          : 1 + Math.sin(this.time * 0.75) * 0.03;
    const scale = (breathe + this.squeeze) || 0.01;
    for (const d of this.dots) {
      let sx = scale;
      if (st === "speaking") {
        // Ripple running down the body: latitude-phased radius wave.
        sx *= 1 + Math.sin(this.time * 6.5 - d.ty * 4) * 0.09;
      }
      const flat = st === "settled";
      const tx = flat ? d.tx : d.tx * sx;
      const ty = flat ? d.ty : d.ty * sx;
      const tz = flat ? d.tz : d.tz * sx;
      d.vx += ((tx - d.x) * k - d.vx * c) * dt;
      d.vy += ((ty - d.y) * k - d.vy * c) * dt;
      d.vz += ((tz - d.z) * k - d.vz * c) * dt;
      d.x += d.vx * dt;
      d.y += d.vy * dt;
      d.z += d.vz * dt;

      // Pointer magnet: only dots NEAR the cursor lean toward it (hard
      // cutoff), in the screen plane, on top of the body motion.
      let ltx = 0;
      let lty = 0;
      if (this.pointer) {
        const [px, py] = this.screenUnit(d, false);
        const dx = this.pointer.x - px;
        const dy = this.pointer.y - py;
        const dist = Math.hypot(dx, dy) + 1e-4;
        const R = 0.55;
        if (dist < R) {
          const f = (1 - dist / R) ** 2 * 0.24;
          ltx = (dx / dist) * f;
          lty = (dy / dist) * f;
        }
      }
      d.lvx += ((ltx - d.lx) * 45 - d.lvx * 9) * dt;
      d.lvy += ((lty - d.ly) * 45 - d.lvy * 9) * dt;
      d.lx += d.lvx * dt;
      d.ly += d.lvy * dt;
    }

    const edgeSpeed = 5;
    for (const e of this.edges) e.w += (e.target - e.w) * Math.min(edgeSpeed * dt, 1);
    this.edges = this.edges.filter((e) => !(e.target === 0 && e.w < 0.03));
  }

  /** Body frame → camera frame (rotation, look bias, tilt). */
  private toCamera(d: Dot): V3 {
    const ry = this.rot + this.lookX;
    const cos = Math.cos(ry);
    const sin = Math.sin(ry);
    const rx = d.x * cos + d.z * sin;
    const rz1 = -d.x * sin + d.z * cos;
    const t = this.tilt + this.lookY;
    const cosT = Math.cos(t);
    const sinT = Math.sin(t);
    return [rx, d.y * cosT - rz1 * sinT, d.y * sinT + rz1 * cosT];
  }

  /** Projected position in unit space (before the canvas mapping). */
  private screenUnit(d: Dot, withLean = true): [number, number, number] {
    const [x, y, z] = this.toCamera(d);
    const persp = FOCAL / (FOCAL - z);
    return [
      x * persp + (withLean ? d.lx : 0),
      y * persp + (withLean ? d.ly : 0),
      persp,
    ];
  }

  /** Project a dot to canvas pixels; returns x, y, scale, depth(0 far..1 near). */
  private project(d: Dot): [number, number, number, number] {
    const [ux, uy, persp] = this.screenUnit(d);
    const half = this.size / 2;
    const unit = half * 0.62;
    const depth = Math.max(0, Math.min(1, (persp - 0.75) / 0.8));
    return [half + ux * unit, half + uy * unit, persp, depth];
  }

  private draw() {
    const inkCtx = this.inkCtx;
    const crispCtx = this.crispCtx;
    if (!inkCtx || !crispCtx) return;
    const size = this.size;
    const { ink, accent, accentOn } = this.opts;

    inkCtx.clearRect(0, 0, size, size);
    crispCtx.clearRect(0, 0, size, size);

    const unit = (size / 2) * 0.62;
    const projected = this.dots.map((d) => this.project(d));

    // Wireframe on the crisp layer: thin, depth-faded lines — this is what
    // makes the cluster read as a globe.
    if (this.edges.length > 0) {
      crispCtx.strokeStyle = ink;
      crispCtx.lineCap = "round";
      for (const e of this.edges) {
        if (e.w <= 0.01) continue;
        const [ax, ay, , da] = projected[e.a];
        const [bx, by, , db] = projected[e.b];
        const depth = (da + db) / 2;
        crispCtx.lineWidth = Math.max(unit * 0.018 * (0.6 + depth * 0.8), 0.6 * this.dpr);
        crispCtx.globalAlpha = e.w * (0.18 + depth * 0.5);
        crispCtx.beginPath();
        crispCtx.moveTo(ax, ay);
        crispCtx.lineTo(bx, by);
        crispCtx.stroke();
      }
      crispCtx.globalAlpha = 1;
    }

    // Ink dots as metaballs, computed HERE (owner, 2026-08-15): the old
    // CSS blur+contrast goo needed an opaque white/black ground dropped by
    // mix-blend-mode, and iOS Safari painted that ground as a solid square
    // (and pure #fff read as an over-bright HDR patch). Now: each dot lays
    // a soft radial field into an offscreen canvas (additive alpha), the
    // field is thresholded per pixel into a crisp, transparent ink layer —
    // overlapping dots still bridge into goo, but nothing is ever painted
    // behind the mark and no blend mode is involved.
    this.drawGoo(projected, unit);

    let accentPulse = 1;
    if (this.state === "speaking") accentPulse = 1 + Math.sin(this.time * 7) * 0.18;

    // Far dots first so near ones overlap them (goo merges anyway, but the
    // crisp accent dot needs correct stacking).
    const order = this.dots.map((_, i) => i).sort((i, j) => projected[i][2] - projected[j][2]);
    for (const i of order) {
      const d = this.dots[i];
      if (!(d.accent && accentOn)) continue;
      const [x, y, persp] = projected[i];
      const r = d.r * unit * persp * accentPulse;
      crispCtx.fillStyle = accent;
      crispCtx.beginPath();
      crispCtx.arc(x, y, Math.max(r, 0.5), 0, Math.PI * 2);
      crispCtx.fill();
    }
  }

  private drawGoo(projected: Array<[number, number, number, number]>, unit: number) {
    const inkCtx = this.inkCtx;
    if (!inkCtx) return;
    const size = this.size;
    if (!this.field || this.field.width !== size) {
      this.field =
        typeof OffscreenCanvas !== "undefined"
          ? new OffscreenCanvas(size, size)
          : (() => {
              const c = document.createElement("canvas");
              c.width = size;
              c.height = size;
              return c;
            })();
      this.fieldCtx = this.field.getContext("2d") as
        | CanvasRenderingContext2D
        | OffscreenCanvasRenderingContext2D
        | null;
    }
    const f = this.fieldCtx;
    if (!f) return;
    f.clearRect(0, 0, size, size);
    f.globalCompositeOperation = "lighter";
    const { accentOn } = this.opts;
    let minX = size;
    let minY = size;
    let maxX = 0;
    let maxY = 0;
    for (let i = 0; i < this.dots.length; i++) {
      const d = this.dots[i];
      if (d.accent && accentOn) continue;
      const [x, y, persp] = projected[i];
      const r = Math.max(d.r * unit * persp, 0.6);
      const R = r * 1.9;
      const g = f.createRadialGradient(x, y, 0, x, y, R);
      // Alpha 0.5 exactly at the dot's own radius: alone, the threshold
      // reproduces the plain disc; two discs near each other sum past
      // 0.5 between them and bridge — the metaball.
      g.addColorStop(0, "rgba(0,0,0,1)");
      g.addColorStop(1 / 1.9, "rgba(0,0,0,0.5)");
      g.addColorStop(1, "rgba(0,0,0,0)");
      f.fillStyle = g;
      f.beginPath();
      f.arc(x, y, R, 0, Math.PI * 2);
      f.fill();
      minX = Math.min(minX, x - R);
      minY = Math.min(minY, y - R);
      maxX = Math.max(maxX, x + R);
      maxY = Math.max(maxY, y + R);
    }
    f.globalCompositeOperation = "source-over";
    const x0 = Math.max(0, Math.floor(minX));
    const y0 = Math.max(0, Math.floor(minY));
    const x1 = Math.min(size, Math.ceil(maxX));
    const y1 = Math.min(size, Math.ceil(maxY));
    if (x1 <= x0 || y1 <= y0) return;
    const img = f.getImageData(x0, y0, x1 - x0, y1 - y0);
    const data = img.data;
    const [ir, ig, ib] = this.inkRgb();
    // Anti-aliased threshold, ~1 device px wide at a big dot's rim (the
    // field falls 0.5 over 0.9 r, so alpha-per-px = 0.55 / r).
    const bigR = Math.max(0.15 * (this.opts.dotScale ?? 1) * unit, 2);
    const edge = 0.55 / bigR;
    for (let p = 0; p < data.length; p += 4) {
      const a = data[p + 3] / 255;
      let o = (a - 0.5) / (2 * edge) + 0.5;
      o = o < 0 ? 0 : o > 1 ? 1 : o;
      data[p] = ir;
      data[p + 1] = ig;
      data[p + 2] = ib;
      data[p + 3] = Math.round(o * 255);
    }
    inkCtx.putImageData(img, x0, y0);
  }

  private inkRgb(): [number, number, number] {
    const h = this.opts.ink.replace("#", "");
    const n = parseInt(h.length === 3 ? h.split("").map((c) => c + c).join("") : h, 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }
}
