# FairSplit Brand Book

Frozen 2026-08-14 from the owner-approved design discussion
(plan record: steady-whistling-hamming). This document is the single
source of truth for FairSplit's visual and verbal identity. Do not
re-litigate decisions recorded here; propose changes as amendments with
owner approval.

## 1. Concept

FairSplit's identity is carried by **one** point of character: **Sem
(셈)**, the in-chat settlement assistant. Sem is a butler omnipotent
*only* within settlement — Jarvis scoped to one job, never a general AI.
The chat-settlement moment is the app's signature.

Framing: Sem is not an external tool but **a member of the group — its
총무** (the money-handling member). One-line character definition:

> 흰 종이 위 검은 잉크 점들이 3D처럼 살아 움직이는, 모임에 끼어 있는
> 정산 총무.
> ("Black ink dots on white paper, alive with 3D motion — the group's
> settlement treasurer who happens to be in the room.")

Rule that resolves "memorable vs. sticks out": **body lives only in
chat; voice lives everywhere.** Sem's visual form appears only as the
chat avatar (and derived logo/app icon). Sem's *voice* carries every
piece of copy — loading, empty, error states are Sem speaking.

## 2. App chrome

- **Brick-lineage restraint**: near-monochrome, clean, no decoration.
  The current violet/shadcn look is a temporary test-phase skeleton and
  will be redone toward this direction.
- Personality is expressed through **vocabulary branding** (own lexicon,
  Brick→Bricked style) and motion — never through loud color or
  ornament.
- Exactly one accent color in the system; it belongs to Sem (see §3).

## 2a. Palette (owner-amended 2026-08-14)

- **Two-tone black / marble-white.** The white is NOT plain `#fff`: it is
  a warm near-white with a faint marble feel — subtle low-contrast gray
  veining, like polished stone or heavy cotton paper. Veining stays
  whisper-level (2–4% contrast); it is a material, not a pattern.
- Ink is near-black (soft black, not `#000` harshness).
- The single accent color survives as the ONE exception to the two-tone
  rule: Sem's own dot. Everything else in the chrome is black/marble.

## 3. The mark: particle dot cluster

Sem's form is a **3D-feeling particle/dot cluster** — movie-AI
visualization lineage (node-edge network, dotted loop, dot-matrix
modernist marks), not a face or mascot.

**Semantic anchor:** dots + edges = the actual settlement graph. People
are nodes, debts are edges; the engine minimizes edges. The mark is a
portrait of what the app computes.

### Material — ink, not glow

- Flat **black ink dots on marble-white** (see §2a). Monochrome ink
  particles + **exactly ONE accent-colored dot = Sem itself**.
- NEVER neon, glow, gradients, or bloom — that is the AI-template
  cliché this brand explicitly rejects.
- Tagline for the material rule: "첨단의 움직임, 인쇄물의 재질"
  (cutting-edge motion, printed-matter material).

### Dot hierarchy

- Few **BIG dots** = group members. Literal count where feasible: one
  dot per member **plus the accent dot = Sem**. A 2-person group renders
  3 dots (2 dots alone never read as a shape). Cap at 6 dots at avatar
  size (Sem + 5 representative); large surfaces uncapped.
- Many **small dots** = the flow between members (money, records,
  calculation). Small screens keep only big dots; large surfaces add the
  small-dot flow.

### Depth without lighting

3D read comes from **dot size variation, overlap, and rotation
parallax** (dotted-loop principle) — flat single color throughout, no
shading. Tech: canvas/Three.js; big dots + dozens of small dots (not
thousands) — phone-friendly.

### Settled glyph / app icon

The settled state locks into a **dot-matrix modernist glyph**
(mark-5152 lineage: big core dots + small satellite dots). This glyph is
the app icon and the frozen avatar for past messages.

## 4. Motion grammar

Dots are **never static** in the live instance: idle is a perpetual,
barely-visible breathing drift (always-on presence). **Motion intensity
is the state signal** — keep large contrast between levels.

| State | Choreography |
|---|---|
| idle | loose breathing ring; whisper-level drift |
| listening | dots lean toward the input |
| thinking | edges appear, network shuffles (parse / FX / receipt) |
| speaking | waveform ripple through the cluster (accent dot pulses) |
| settled | edges clear; dots snap into the dot-matrix glyph |

Rules:

- Only **ONE live instance** animates — the current/latest avatar. Past
  message avatars freeze into the settled glyph (past turns are already
  매듭지어진).
- A new member joining = a dot animates in.
- `prefers-reduced-motion` → static settled glyph everywhere.
- Motion target: "Interactive Three.js Particle Morph" CodePen lineage
  (see §7) — its *motion*, never its neon material.

## 5. Name and voice

The assistant is **셈** (English: **Sem**) — native Korean for
counting/reckoning (셈하다, 셈이 빠르다). The app name stays FairSplit.

- **Where the name lives:** Sem's own speech and the chat sender label.
  NOT user commands — the parser must never require the name. Users type
  plain imperatives ("정산 올려"). Recognizing "셈아…" as an optional
  easter-egg address is fine.
- **Self-reference pattern (ko):** "셈이 …" (reads as subject-marked
  name and affectionate pet-name form). Used ONLY at signature moments:
  - first greeting
  - loading/thinking — "셈이 계산하고 있어요…"
  - completion — "셈이 매듭지어뒀어요"
  - apology/error — "셈이 잠깐 놓쳤어요"
- All other copy speaks plainly without the name. Register: FRIDAY-like
  casual-warm colleague, **해요체, Toss register** (standing rule).
  English mirror: "Sem is adding it up…", "Sem settled it."
- **Lexicon:** 매듭짓다 = completion verb family (ko). 총무 = role word
  for introductions ("모임마다 총무 하나, 셈"). Do not overuse either.
- Contrast is intentional: sharp constructed form + warm casual voice.

## 6. Copy surfaces (integration checklist)

Signature-moment rewrites in Sem's voice, ko + en (next-intl keys in
`src/messages/`): `loading.general`, `loading.status`,
`errors.unexpected.body`, `chat.placeholder`, `empty.noSpending`,
`chat.persist.failed`, `assistant.guided.ack`. Plus chat sender label
"셈"/"Sem", and replacement of placeholder `public/icon.svg` and stale
manifest colors with the settled glyph.

## 7. Reference inventory (canonical — do not improvise beyond these)

Live motion targets:

- https://codepen.io/VoXelo/pen/ByyBqVX — Interactive Three.js Particle
  Morph (closest to intended avatar motion; strip the neon).
- https://codepen.io/bradarnett/pen/jZPwpv — Particles Morph (same
  lineage; strip the neon).
- https://smoothui.dev/docs/components/siri-orb — state-switcher grammar
  (idle/listening/thinking/streaming/done/error).
- Google Assistant 4-dot state GIFs (idle float / listening bars /
  speaking waveform / thinking spin).

Image references (owner-supplied):

- Modernist dot-matrix marks **5152/5153/5156/5157** — 5152 (dot cross:
  big core + small satellites) is the settled-glyph/app-icon direction.
- **Dotted loop** (lasso/figure-eight of dots; size gradient alone
  creates 3D perspective) — the depth-without-lighting principle.
- **3D node-edge network** (matte black spheres + thin lines on white) —
  the thinking-state settlement graph.
- **Dot helix** (DNA-like dot columns joined by tapering bars) —
  dot-plus-bar rhythm reference.
- **Metaball split/bloom video** (owner-supplied, Klickpin/Pinterest,
  2026-08-14): a single soft black dot on warm off-white splits with
  gooey liquid necks into a symmetric molecular cluster, then merges
  back to one dot. THE motion-material reference for how Sem's dots
  merge and separate: blobby metaball connections, flat ink, no glow.
- 4×4 soft pebble grid — large-surface texture lineage.

Anti-references: neon/glow particle aesthetics, impossible-figure
(Penrose/crypto-generic) marks, thin-line marks that die at 24 px.

## 8. Amendment log

- 2026-08-14: initial freeze.
- 2026-08-14 (owner): palette fixed to black / marble-white two-tone
  (§2a); metaball split/bloom video added as the canonical
  motion-material reference (§7).
