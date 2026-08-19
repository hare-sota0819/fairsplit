# Patch batch 1 — tokens + fonts (verbatim file replacements)

These are complete files, not diffs. Copy each over the repo path listed,
byte for byte. Do not reinterpret, reformat, or "improve" them.

| Patch file | Replaces |
| --- | --- |
| patches/src/app/globals.css | src/app/globals.css |
| patches/src/app/layout.tsx | src/app/layout.tsx |

What this batch does on its own:
- Every screen goes neutral statement gray (page #fafafa, ink #141414,
  hairlines) in light AND dark; marble texture, violet blooms and the
  vermilion accent are gone (tokens keep their names, so nothing breaks).
- radius tokens all resolve to 0.
- One easing app-wide (cubic-bezier(.22,.61,.36,1)).
- Fonts: Newsreader (display, via next/font) + Pretendard Variable (UI,
  via CDN link). Geist is removed from layout.tsx.
- <Backdrop /> still mounts but draws nothing (classes are inert).

Build notes:
- Run the build. If scripts/design/contrast-check.mjs fails, DO NOT tweak
  values yourself — report the exact failing pairs back, values will be
  re-issued. (--border was already darkened to #dcdcdc to clear the 1.2:1
  border floor on #fafafa.)
- grep for `--font-geist` after applying: any remaining references
  (e.g. a stray font-mono usage) resolve via the new --font-mono stack;
  none should error, but report any that look wrong.
- Do NOT restyle components in this batch. Batch 2 (landing page.tsx +
  nav/demo components + message keys) and batch 3 (chat screen, sidebar)
  follow as the same kind of verbatim replacements.
