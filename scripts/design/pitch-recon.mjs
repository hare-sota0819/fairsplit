// Pitch.com recon capture — Task 1 of the design-overhaul plan
// (docs/superpowers/plans/2026-08-09-pitch-design-overhaul.md §Task 1).
// Read-only measurement: full-page + stepped screenshots, computed-style
// harvest, keyframes/transitions/custom-property harvest from stylesheets
// AND from inline-style var() usage (this site is Framer-built and keeps its
// design tokens in inline styles, not :root), getAnimations, document.fonts,
// a canvas/WebGL/video census, section + "band" backgrounds, decorative
// surfaces (shadow/gradient/backdrop-filter chrome), press-state triples,
// and a shader-fragment hunt over the page's own JS bundles.
//
// Usage: node scripts/design/pitch-recon.mjs <output-dir>
// Output: <output-dir>/{desktop,mobile}/*.png, */video.webm, extract.json
import { chromium, devices } from '@playwright/test'
import fs from 'node:fs'
import path from 'node:path'

const OUT_DIR = process.argv[2]
if (!OUT_DIR) {
  console.error('Usage: node scripts/design/pitch-recon.mjs <output-dir>')
  process.exit(1)
}

const BASE_URL = 'https://pitch.com/'
const SETTLE_MS = 600
const SCROLL_FRACTIONS = Array.from({ length: 10 }, (_, i) => i / 10) // 0%..90%
const REAL_UA_DESKTOP =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'
const REAL_UA_MOBILE =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/124.0.0.0 Mobile/15E148 Safari/604.1'

// Widened past `button, [class*="btn"]` — Pitch's actual CTAs are plain
// `<a href>` elements with no "btn" class (e.g. the nav "Sign up" link), and
// some custom controls use role=button instead of a real <button>.
const CTA_SELECTOR = 'button, [class*="btn"], a[href], [role="button"]'

// Properties harvested for every computed-style probe (headings, body,
// buttons, etc.) — enough to derive the type scale and button chrome.
const STYLE_PROPS = [
  'fontFamily',
  'fontSize',
  'fontWeight',
  'letterSpacing',
  'lineHeight',
  'color',
  'background',
  'backgroundImage',
  'borderRadius',
  'boxShadow',
  'padding',
  'transition',
]

// Properties diffed across the rest -> hover -> down press-state triple.
const PRESS_PROPS = [
  'background',
  'backgroundColor',
  'boxShadow',
  'transform',
  'color',
  'borderColor',
  'transition',
  'opacity',
]

const SHADER_REGEX = /precision\s+(?:high|medium|low)p|gl_FragColor|void\s+main\s*\(/g

const VIEWPORT_SPECS = [
  {
    name: 'desktop',
    contextOptions: {
      viewport: { width: 1440, height: 900 },
      deviceScaleFactor: 2,
      isMobile: false,
      hasTouch: false,
    },
    capturePressStates: true,
  },
  {
    name: 'mobile',
    contextOptions: {
      ...devices['iPhone 15'],
      viewport: { width: 393, height: 852 },
      deviceScaleFactor: 3,
      hasTouch: true,
      isMobile: true,
    },
    // Touch has no hover/press affordance to emulate meaningfully — mobile
    // still gets its CTA/button computed styles (rest state only) via the
    // same captureCtaStates() call, just non-interactive.
    capturePressStates: false,
  },
]

function log(...args) {
  console.log('[pitch-recon]', ...args)
}

function ensureDir(p) {
  fs.mkdirSync(p, { recursive: true })
}

// Parses the longest duration out of a CSS `transition` shorthand (which may
// list several comma-separated property/duration/easing groups) so a
// press-state read can wait for the slowest one to actually finish rather
// than a fixed guess. Falls back to a small default for `none`/unparsable
// values so a press-state read is never skipped entirely.
function parseMaxDurationMs(transitionValue) {
  if (!transitionValue || transitionValue === 'none') return 200
  const matches = transitionValue.match(/[\d.]+m?s\b/g)
  if (!matches || matches.length === 0) return 200
  let max = 0
  for (const raw of matches) {
    const ms = raw.endsWith('ms') ? parseFloat(raw) : parseFloat(raw) * 1000
    if (ms > max) max = ms
  }
  return max || 200
}

// Installed via context.addInitScript so it runs BEFORE any page script on
// every navigation — required to see canvases created early (e.g. hero
// WebGL) and every getContext() call, not just the ones live at probe time.
function installCanvasCensus() {
  window.__canvasCensus = []
  const orig = HTMLCanvasElement.prototype.getContext
  HTMLCanvasElement.prototype.getContext = function (type, ...rest) {
    try {
      window.__canvasCensus.push({
        type,
        width: this.width,
        height: this.height,
        id: this.id || null,
        className: (this.className || '').toString(),
      })
    } catch {
      // Never let census bookkeeping break the page.
    }
    return orig.apply(this, [type, ...rest])
  }
}

// Runs inside the page via page.evaluate. Self-contained: Playwright
// serializes arguments, not closures, so nothing outer-scope is reachable
// here except what's passed in as the single args object.
function harvestPage({ styleProps, ctaSelector }) {
  // Deliberately boundary-free: vendor markers show up as substrings inside
  // longer class names (`intercom-lightweight-app`, `styles__intercomLauncher`),
  // so anchoring on `-`/`_` boundaries missed every class-selector hit and let
  // widget chrome leak into the motion/transition harvest.
  const THIRD_PARTY_RE = /intercom|__framer-editorbar/i

  function isThirdPartyNode(el) {
    if (!el) return false
    const cls = (el.className || '').toString()
    const id = el.id || ''
    return THIRD_PARTY_RE.test(cls) || THIRD_PARTY_RE.test(id)
  }

  function rectOf(el) {
    const r = el.getBoundingClientRect()
    return { x: r.x, y: r.y, width: r.width, height: r.height }
  }

  function pickStyle(el) {
    const cs = getComputedStyle(el)
    const out = {}
    for (const prop of styleProps) out[prop] = cs[prop]
    return out
  }

  // body/p/a/nav: one representative sample is enough (structural, not a
  // multi-variant scale). h1/h2/h3: EVERY match, deduped by style signature
  // with a text/rect sample and a hit count — a page can carry several
  // distinct h2 sizes (section headers vs. card titles), and averaging "the
  // first h2" into the scale silently throws that variation away.
  function harvestSelectors() {
    const result = {}
    for (const sel of ['body', 'p', 'a', 'nav']) {
      const el = document.querySelector(sel)
      result[sel] = el
        ? {
            style: pickStyle(el),
            sampleText: (el.textContent || '').trim().slice(0, 60),
            sampleRect: rectOf(el),
          }
        : null
    }
    for (const sel of ['h1', 'h2', 'h3']) {
      const seen = new Map()
      for (const el of document.querySelectorAll(sel)) {
        const style = pickStyle(el)
        const sig = JSON.stringify(style)
        if (seen.has(sig)) {
          seen.get(sig).count++
          continue
        }
        seen.set(sig, {
          style,
          sampleText: (el.textContent || '').trim().slice(0, 60),
          sampleRect: rectOf(el),
          count: 1,
        })
      }
      result[sel] = [...seen.values()].slice(0, 30)
    }
    return result
  }

  function harvestButtons() {
    const nodes = [...document.querySelectorAll(ctaSelector)].slice(0, 300)
    const seen = new Map()
    const all = []
    for (const el of nodes) {
      const style = pickStyle(el)
      const sig = JSON.stringify(style)
      const entry = {
        tag: el.tagName.toLowerCase(),
        className: (el.className || '').toString(),
        text: (el.textContent || '').trim().slice(0, 40),
        style,
        thirdParty: isThirdPartyNode(el),
      }
      all.push(entry)
      if (!seen.has(sig)) seen.set(sig, entry)
    }
    return { all, distinct: [...seen.values()] }
  }

  // Keyframes + transitions + custom-property DECLARATIONS, all harvested
  // from document.styleSheets in one walk. Cross-origin sheets throw on
  // .cssRules access — caught per-sheet and recorded as skipped rather than
  // aborting the whole harvest. Custom props are collected from ANY rule,
  // not just `:root` — don't assume that's where a theme layer keeps its
  // variables (this site turned out to declare none in CSS at all; see
  // harvestInlineTokens for where its tokens actually live).
  function harvestStylesheets() {
    const keyframes = []
    const transitions = []
    const skippedSheets = []
    const declaredVars = {}

    const walk = (rules) => {
      for (const rule of rules) {
        if (rule.type === CSSRule.KEYFRAMES_RULE) {
          keyframes.push({
            name: rule.name,
            frames: [...rule.cssRules].map((r) => ({
              keyText: r.keyText,
              cssText: r.cssText,
            })),
            thirdParty: THIRD_PARTY_RE.test(rule.name),
          })
        } else if (rule.style && rule.style.transition && rule.style.transition.length > 0) {
          transitions.push({
            selectorText: rule.selectorText || null,
            transition: rule.style.transition,
            thirdParty: rule.selectorText ? THIRD_PARTY_RE.test(rule.selectorText) : false,
          })
        }
        if (rule.style) {
          for (let i = 0; i < rule.style.length; i++) {
            const prop = rule.style[i]
            if (prop.startsWith('--')) {
              declaredVars[prop] = rule.style.getPropertyValue(prop).trim()
            }
          }
        }
        if (rule.cssRules) walk(rule.cssRules)
      }
    }

    for (const sheet of document.styleSheets) {
      try {
        walk(sheet.cssRules)
      } catch {
        skippedSheets.push(sheet.href || '(inline)')
      }
    }

    return { keyframes, transitions, skippedSheets, declaredVars }
  }

  // Custom-property USAGE from inline styles. This site never declares
  // --token-* anywhere in CSS or as an inline declaration — every reference
  // is `var(--token-<uuid>, <fallback>)`, and the fallback IS the resolved
  // value (confirmed: getComputedStyle(document.body) returns '' for every
  // one of these names — the property itself is undefined everywhere). So
  // the "value" of a token here is its fallback, and "how central is this
  // token to the palette" is its reference count.
  function harvestInlineTokens() {
    const usage = new Map()
    const varRe = /var\(\s*(--[\w-]+)\s*(?:,\s*((?:rgba?\([^()]*\))|[^,()]+))?\)/g
    for (const el of document.querySelectorAll('[style]')) {
      const styleAttr = el.getAttribute('style') || ''
      if (!styleAttr.includes('var(')) continue
      const tp = isThirdPartyNode(el)
      varRe.lastIndex = 0
      let m
      while ((m = varRe.exec(styleAttr))) {
        const name = m[1]
        const fallback = m[2] ? m[2].trim() : null
        if (!usage.has(name)) {
          usage.set(name, { count: 0, fallbackValues: new Set(), thirdParty: false })
        }
        const entry = usage.get(name)
        entry.count++
        if (fallback) entry.fallbackValues.add(fallback)
        if (tp) entry.thirdParty = true
      }
    }
    return [...usage.entries()]
      .map(([name, v]) => ({
        name,
        usageCount: v.count,
        fallbackValues: [...v.fallbackValues],
        thirdParty: v.thirdParty,
      }))
      .sort((a, b) => b.usageCount - a.usageCount)
  }

  function harvestAnimations() {
    return document.getAnimations().map((a) => {
      const timing = a.effect && a.effect.getTiming ? a.effect.getTiming() : {}
      const target = a.effect && a.effect.target
      return {
        name: a.animationName || a.id || null,
        duration: timing.duration ?? null,
        easing: timing.easing ?? null,
        iterations: timing.iterations ?? null,
        targetTag: target ? target.tagName.toLowerCase() : null,
        targetClass: target ? (target.className || '').toString() : null,
        thirdParty: target ? isThirdPartyNode(target) : false,
      }
    })
  }

  // Every element whose inline `transition`/`animation` is set — the real
  // motion vocabulary on a Framer site, which keeps almost none of it in
  // stylesheets. Deduped by exact declaration text with a hit count, so
  // "filter .2s ease-out x42" reads as one entry with count 42, not 42 rows.
  function harvestInlineMotion() {
    const seen = new Map()
    for (const el of document.querySelectorAll('[style]')) {
      const transition = el.style.transition
      const animation = el.style.animation
      if (!transition && !animation) continue
      const sig = JSON.stringify([transition, animation])
      if (seen.has(sig)) {
        seen.get(sig).count++
        continue
      }
      seen.set(sig, {
        transition: transition || null,
        animation: animation || null,
        count: 1,
        sampleTag: el.tagName.toLowerCase(),
        sampleClassName: (el.className || '').toString().slice(0, 80),
        thirdParty: isThirdPartyNode(el),
      })
    }
    return [...seen.values()].sort((a, b) => b.count - a.count)
  }

  function harvestFonts() {
    const out = []
    document.fonts.forEach((f) => {
      out.push({ family: f.family, weight: f.weight, style: f.style, status: f.status })
    })
    return out
  }

  function harvestSectionBackgrounds() {
    const sections = [document.querySelector('header'), ...document.querySelectorAll('section')]
      .filter(Boolean)
      .map((el) => {
        const cs = getComputedStyle(el)
        return {
          tag: el.tagName.toLowerCase(),
          id: el.id || null,
          className: (el.className || '').toString(),
          background: cs.background,
          backgroundImage: cs.backgroundImage,
          backdropFilter: cs.backdropFilter || cs.webkitBackdropFilter || null,
        }
      })

    // Framer doesn't necessarily wrap every visual "band" in a <section> —
    // most of its content chrome carries a data-framer-name instead. This
    // catches the light/white bands BETWEEN the purple hero sections, which
    // the plain <section> scan above reports as transparent (they inherit
    // their surface from a wrapper div, not the <section> tag itself).
    const seenBands = new Map()
    for (const el of document.querySelectorAll('[data-framer-name]')) {
      const cs = getComputedStyle(el)
      const bg = cs.backgroundColor
      if (bg === 'rgba(0, 0, 0, 0)' && cs.backgroundImage === 'none') continue
      const rect = el.getBoundingClientRect()
      if (rect.width < 200 || rect.height < 40) continue // skip small decorative bits
      const sig = JSON.stringify([bg, cs.backgroundImage])
      if (seenBands.has(sig)) continue
      seenBands.set(sig, {
        tag: el.tagName.toLowerCase(),
        dataFramerName: el.getAttribute('data-framer-name'),
        background: cs.background,
        backgroundColor: bg,
        backgroundImage: cs.backgroundImage,
        rect: rectOf(el),
      })
    }

    return { sections, bands: [...seenBands.values()].slice(0, 40) }
  }

  function harvestCanvasElements() {
    return [...document.querySelectorAll('canvas')].map((c) => {
      const rect = c.getBoundingClientRect()
      return {
        width: c.width,
        height: c.height,
        cssWidth: rect.width,
        cssHeight: rect.height,
        id: c.id || null,
        className: (c.className || '').toString(),
      }
    })
  }

  function harvestVideoElements() {
    return [...document.querySelectorAll('video')].map((v) => ({
      src: v.currentSrc || v.src || null,
      poster: v.poster || null,
      autoplay: v.autoplay,
      loop: v.loop,
      muted: v.muted,
      width: v.videoWidth,
      height: v.videoHeight,
      rect: rectOf(v),
    }))
  }

  // The reference material for the hero "prompt wrapper" card and similar
  // chrome: EVERY element with a non-none boxShadow/backgroundImage/
  // backdropFilter, deduped by exact value signature (this page only has a
  // handful, but cap it anyway so a busier page can't blow up the payload),
  // plus the spacing/border numbers T3's hairline gate needs.
  function harvestDecorativeSurfaces() {
    const seen = new Map()
    for (const el of document.querySelectorAll('body *')) {
      const cs = getComputedStyle(el)
      const boxShadow = cs.boxShadow
      const backgroundImage = cs.backgroundImage
      const backdropFilter = cs.backdropFilter || cs.webkitBackdropFilter || 'none'
      if (boxShadow === 'none' && backgroundImage === 'none' && backdropFilter === 'none') continue
      const rect = el.getBoundingClientRect()
      if (rect.width === 0 || rect.height === 0) continue
      const sig = JSON.stringify([boxShadow, backgroundImage, backdropFilter, cs.borderRadius])
      if (seen.has(sig)) continue
      seen.set(sig, {
        tag: el.tagName.toLowerCase(),
        className: (el.className || '').toString().slice(0, 80),
        text: (el.textContent || '').trim().slice(0, 40),
        rect: rectOf(el),
        boxShadow,
        backgroundImage,
        backdropFilter,
        borderRadius: cs.borderRadius,
        borderWidth: cs.borderWidth,
        borderColor: cs.borderColor,
        borderStyle: cs.borderStyle,
        padding: cs.padding,
        margin: cs.margin,
        gap: cs.gap,
      })
      if (seen.size >= 200) break
    }
    return [...seen.values()]
  }

  return {
    computedStyles: harvestSelectors(),
    buttons: harvestButtons(),
    stylesheets: harvestStylesheets(),
    inlineTokens: harvestInlineTokens(),
    animations: harvestAnimations(),
    inlineMotion: harvestInlineMotion(),
    fonts: harvestFonts(),
    sectionBackgrounds: harvestSectionBackgrounds(),
    canvasElements: harvestCanvasElements(),
    videoElements: harvestVideoElements(),
    decorativeSurfaces: harvestDecorativeSurfaces(),
  }
}

async function readPressStyle(locator) {
  return locator.evaluate((el, props) => {
    const cs = getComputedStyle(el)
    const out = {}
    for (const p of props) out[p] = cs[p]
    // `color` on the outer element is frequently an unset inherited default
    // (Framer-style markup nests the actual text in a styled child div/span),
    // so also resolve the color actually used to paint the visible label by
    // walking to the first non-empty text node's parent.
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT)
    let node
    let textColor = null
    while ((node = walker.nextNode())) {
      if (node.textContent && node.textContent.trim().length > 0) {
        textColor = getComputedStyle(node.parentElement).color
        break
      }
    }
    out.textColor = textColor
    return out
  }, PRESS_PROPS)
}

// Full rest -> hover -> down capture (desktop only — see captureRestOnlyState
// for the mobile/non-interactive equivalent). Waits out the element's OWN
// declared transition duration (+50ms) before each read instead of a fixed
// guess, so a slow transition (this site has some at 400-500ms) isn't read
// mid-animation.
async function capturePressTriple(page, selector, label) {
  const locator = page.locator(selector).first()
  const rest = await readPressStyle(locator)
  const settleMs = Math.min(parseMaxDurationMs(rest.transition) + 50, 2000)

  await locator.scrollIntoViewIfNeeded()
  let hoverFailed = false
  try {
    await locator.hover()
  } catch (e) {
    hoverFailed = true
    log(`hover() failed for ${selector}: ${e.message}`)
  }
  await page.waitForTimeout(settleMs)
  const hover = await readPressStyle(locator)

  const box = await locator.boundingBox()
  let down = hover
  let downCaptured = false
  if (box) {
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
    await page.mouse.down()
    await page.waitForTimeout(settleMs)
    down = await readPressStyle(locator)
    downCaptured = true
    // Targets are frequently real <a>/<button> elements (nav CTA, submit
    // buttons). A click only fires when mouseup lands on the same element as
    // mousedown, so move away first — this captures the pressed style
    // without triggering a real navigation/submit on mouse.up().
    await page.mouse.move(0, 0)
    await page.mouse.up()
  }

  const identicalTriple =
    JSON.stringify(rest) === JSON.stringify(hover) && JSON.stringify(hover) === JSON.stringify(down)

  return { label, rest, hover, down, hoverFailed, downCaptured, identicalTriple, restOnly: false }
}

// Mobile/non-interactive equivalent: touch has no hover/press affordance to
// fake meaningfully, so this records only the REST computed style — never a
// fabricated hover/down reading.
async function captureRestOnlyState(page, selector, label) {
  const locator = page.locator(selector).first()
  const rest = await readPressStyle(locator)
  return {
    label,
    rest,
    hover: null,
    down: null,
    hoverFailed: null,
    downCaptured: false,
    identicalTriple: null,
    restOnly: true,
  }
}

// Tags the nav CTA + first 3 distinct button styles with a temporary
// data-recon-press attribute so Playwright locators can address the exact
// same DOM node across the capture sequence, then reads each one — the full
// rest/hover/down triple when `interactive`, rest-only otherwise.
async function captureCtaStates(page, distinctButtons, { interactive }) {
  const results = []

  const captureOne = async (selector, label) => {
    try {
      return interactive
        ? await capturePressTriple(page, selector, label)
        : await captureRestOnlyState(page, selector, label)
    } catch (e) {
      log(`CTA state capture failed for ${label}: ${e.message}`)
      if (page.url() !== BASE_URL) {
        await page.goto(BASE_URL, { waitUntil: 'networkidle', timeout: 45000 })
      }
      return null
    }
  }

  const navCtaFound = await page.evaluate((sel) => {
    const nav = document.querySelector('nav')
    if (!nav) return false
    const candidates = [...nav.querySelectorAll(sel)]
    const cta = candidates[candidates.length - 1]
    if (!cta) return false
    cta.setAttribute('data-recon-press', 'cta')
    return true
  }, CTA_SELECTOR)

  if (navCtaFound) {
    const r = await captureOne('[data-recon-press="cta"]', 'nav-cta')
    if (r) results.push(r)
  }

  // A computed `transition` of `all 0s ease 0s` (or plain `all`) means the
  // element declares no real transition — pressing it can only ever produce an
  // identical triple. Float the buttons that DO declare a specific transition
  // to the front so the press-state budget is spent on targets that can move,
  // then widen the budget from 3 to 8 (stable order otherwise, so the
  // no-transition styles are still sampled if slots remain).
  const declaresMotion = (b) => {
    const t = (b.style && b.style.transition) || ''
    return t.length > 0 && !/^all\b/.test(t.trim())
  }
  const targets = [
    ...distinctButtons.filter(declaresMotion),
    ...distinctButtons.filter((b) => !declaresMotion(b)),
  ].slice(0, 8)
  for (let i = 0; i < targets.length; i++) {
    const marker = `btn-${i}`
    const tagged = await page.evaluate(
      ({ sig, marker, styleProps, sel }) => {
        const nodes = [...document.querySelectorAll(sel)]
        for (const el of nodes) {
          const cs = getComputedStyle(el)
          const testSig = JSON.stringify(Object.fromEntries(styleProps.map((p) => [p, cs[p]])))
          if (testSig === sig) {
            el.setAttribute('data-recon-press', marker)
            return true
          }
        }
        return false
      },
      { sig: JSON.stringify(targets[i].style), marker, styleProps: STYLE_PROPS, sel: CTA_SELECTOR },
    )
    if (tagged) {
      const r = await captureOne(`[data-recon-press="${marker}"]`, marker)
      if (r) results.push(r)
    }
  }

  return results
}

async function huntShaders(jsUrls) {
  const hits = []
  for (const url of jsUrls) {
    try {
      const res = await fetch(url)
      if (!res.ok) continue
      const text = await res.text()
      SHADER_REGEX.lastIndex = 0
      let match
      while ((match = SHADER_REGEX.exec(text))) {
        const start = Math.max(0, match.index - 2000)
        const end = Math.min(text.length, match.index + 2000)
        hits.push({
          url,
          index: match.index,
          matchedText: match[0],
          excerpt: text.slice(start, end),
        })
      }
    } catch (e) {
      log(`Shader hunt: failed to fetch ${url}: ${e.message}`)
    }
  }
  return hits
}

// Collects candidate secondary-page links from the visible top nav. Mobile's
// collapsed nav only exposes the logo link (the rest live behind a
// JS-toggled overlay that isn't in the DOM's <nav>), so callers should
// prefer the set discovered on desktop and only fall back to this when none
// is available yet.
async function findSecondaryLinks(page) {
  const links = await page.evaluate(() => {
    const nav = document.querySelector('nav')
    if (!nav) return []
    return [...nav.querySelectorAll('a[href]')]
      .map((a) => ({ href: a.href, text: (a.textContent || '').trim() }))
      .filter((l) => l.href && l.href.startsWith('http'))
  })
  const home = new URL(BASE_URL).href
  const unique = []
  const seen = new Set()
  for (const l of links) {
    if (l.href === home || seen.has(l.href)) continue
    seen.add(l.href)
    unique.push(l)
  }
  const priority = unique.filter((l) => /product|tour|feature|pricing/i.test(l.text + l.href))
  const rest = unique.filter((l) => !priority.includes(l))
  return [...priority, ...rest].slice(0, 2)
}

// `knownLinks`, when provided, is reused as-is (see findSecondaryLinks doc)
// so both viewports corroborate the same two pages.
async function captureSecondaryPages(page, dir, knownLinks) {
  const links = knownLinks && knownLinks.length ? knownLinks : await findSecondaryLinks(page)
  const results = []
  for (let i = 0; i < links.length; i++) {
    const link = links[i]
    try {
      const resp = await page.goto(link.href, { waitUntil: 'networkidle', timeout: 30000 })
      const filename = `secondary-${i}.png`
      await page.screenshot({ path: path.join(dir, filename), fullPage: true })
      results.push({
        href: link.href,
        text: link.text,
        status: resp?.status() ?? null,
        screenshot: filename,
      })
    } catch (e) {
      results.push({ href: link.href, text: link.text, error: e.message })
    }
  }
  return results
}

async function detectBlocked(page, response) {
  if (response && response.status() >= 400) return true
  const title = await page.title().catch(() => '')
  if (/attention required|access denied|just a moment|are you human/i.test(title)) return true
  return false
}

async function probeReachability(launchOptions, uaOverride) {
  const browser = await chromium.launch(launchOptions)
  const context = await browser.newContext(uaOverride ? { userAgent: uaOverride } : {})
  const page = await context.newPage()
  let response
  try {
    response = await page.goto(BASE_URL, { waitUntil: 'domcontentloaded', timeout: 20000 })
  } catch (e) {
    await browser.close()
    return { blocked: true, reason: e.message }
  }
  const blocked = await detectBlocked(page, response)
  await browser.close()
  return { blocked, reason: blocked ? `status=${response?.status()}` : null }
}

// Read-only reachability check with the plain -> channel:'chrome'+real-UA
// fallback the brief mandates. Throws (never fabricates data) if both fail.
// Returns only whether the fallback channel is needed — the actual UA string
// used per capture context is chosen later, per viewport (see main()): a
// single UA blindly applied to both desktop AND mobile contexts would
// clobber the iPhone device's own UA on the mobile pass.
async function resolveLaunchOptions() {
  log('Probing pitch.com reachability (plain chromium)...')
  const plain = await probeReachability({})
  if (!plain.blocked) return {}

  log(`Blocked on first attempt (${plain.reason}). Retrying with channel:'chrome' + real UA...`)
  const retry = await probeReachability({ channel: 'chrome' }, REAL_UA_DESKTOP)
  if (!retry.blocked) return { channel: 'chrome' }

  throw new Error(
    `pitch.com blocked automation on both attempts (plain: ${plain.reason}; chrome+UA: ${retry.reason}). STOPPING — not fabricating data.`,
  )
}

async function main() {
  ensureDir(OUT_DIR)
  for (const spec of VIEWPORT_SPECS) ensureDir(path.join(OUT_DIR, spec.name))

  const launchOptions = await resolveLaunchOptions()
  log('Launch options resolved:', JSON.stringify(launchOptions))

  const extract = {
    viewports: [],
    computedStyles: {},
    rootVars: {},
    keyframes: {},
    transitions: {},
    skippedStylesheets: {},
    animations: {},
    inlineMotion: {},
    fonts: {},
    canvas: { byViewport: {}, shaderHits: [] },
    videos: {},
    decorativeSurfaces: {},
    pressStates: {},
    sectionBackgrounds: {},
    secondaryPages: {},
  }

  const browser = await chromium.launch(launchOptions.channel ? { channel: launchOptions.channel } : {})

  // Discovered once (desktop's uncollapsed nav is the reliable source; mobile's
  // is a JS-toggled overlay not reachable via querySelector) and reused across
  // viewports so both capture the same two secondary pages.
  let secondaryLinks = null

  for (const spec of VIEWPORT_SPECS) {
    log(`--- Viewport: ${spec.name} ---`)
    const dir = path.join(OUT_DIR, spec.name)
    const contextOpts = {
      ...spec.contextOptions,
      recordVideo: { dir },
    }
    if (launchOptions.channel) {
      // Only override when the fallback path actually ran, and pick the UA
      // matching THIS viewport's device — a single desktop UA spread over
      // both contexts (the previous bug) would clobber the iPhone's own UA
      // on the mobile pass and make the site serve/behave as desktop there.
      contextOpts.userAgent = spec.name === 'mobile' ? REAL_UA_MOBILE : REAL_UA_DESKTOP
    }
    const context = await browser.newContext(contextOpts)
    // Must be installed before goto() so it's live for the very first canvas.
    await context.addInitScript(installCanvasCensus)
    const page = await context.newPage()

    const response = await page.goto(BASE_URL, { waitUntil: 'networkidle', timeout: 45000 })
    log(`Loaded ${BASE_URL} -> status ${response?.status()}`)

    extract.viewports.push({
      name: spec.name,
      width: spec.contextOptions.viewport.width,
      height: spec.contextOptions.viewport.height,
      deviceScaleFactor: spec.contextOptions.deviceScaleFactor,
      touch: !!spec.contextOptions.hasTouch,
    })

    await page.screenshot({ path: path.join(dir, 'full-page.png'), fullPage: true })

    for (const frac of SCROLL_FRACTIONS) {
      await page.evaluate((f) => {
        const max = document.documentElement.scrollHeight - window.innerHeight
        window.scrollTo(0, Math.max(0, max * f))
      }, frac)
      await page.waitForTimeout(SETTLE_MS)
      const pct = Math.round(frac * 100)
      await page.screenshot({ path: path.join(dir, `scroll-${String(pct).padStart(2, '0')}.png`) })
    }
    await page.evaluate(() => window.scrollTo(0, 0))
    await page.waitForTimeout(SETTLE_MS)

    const harvested = await page.evaluate(harvestPage, { styleProps: STYLE_PROPS, ctaSelector: CTA_SELECTOR })
    extract.computedStyles[spec.name] = {
      ...harvested.computedStyles,
      buttonsAll: harvested.buttons.all,
      buttonsDistinct: harvested.buttons.distinct,
    }
    extract.rootVars[spec.name] = {
      declared: harvested.stylesheets.declaredVars,
      inline: harvested.inlineTokens,
    }
    extract.keyframes[spec.name] = harvested.stylesheets.keyframes
    extract.transitions[spec.name] = harvested.stylesheets.transitions
    extract.skippedStylesheets[spec.name] = harvested.stylesheets.skippedSheets
    extract.animations[spec.name] = harvested.animations
    extract.inlineMotion[spec.name] = harvested.inlineMotion
    extract.fonts[spec.name] = harvested.fonts
    extract.sectionBackgrounds[spec.name] = harvested.sectionBackgrounds
    extract.decorativeSurfaces[spec.name] = harvested.decorativeSurfaces
    extract.videos[spec.name] = harvested.videoElements

    const canvasCensusLog = await page.evaluate(() => window.__canvasCensus || [])
    extract.canvas.byViewport[spec.name] = {
      elements: harvested.canvasElements,
      contextCalls: canvasCensusLog,
    }

    extract.pressStates[spec.name] = await captureCtaStates(page, harvested.buttons.distinct, {
      interactive: spec.capturePressStates,
    })

    const resourceUrls = await page.evaluate(() =>
      performance.getEntriesByType('resource').map((r) => r.name),
    )
    const jsUrls = [...new Set(resourceUrls.filter((u) => /\.js(\?|$)/.test(u)))]
    extract.canvas.shaderHits.push(...(await huntShaders(jsUrls)))

    if (!secondaryLinks) secondaryLinks = await findSecondaryLinks(page)
    extract.secondaryPages[spec.name] = await captureSecondaryPages(page, dir, secondaryLinks)

    await context.close()
  }

  await browser.close()

  const seen = new Set()
  extract.canvas.shaderHits = extract.canvas.shaderHits.filter((h) => {
    const key = `${h.url}::${h.index}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })

  const outPath = path.join(OUT_DIR, 'extract.json')
  fs.writeFileSync(outPath, JSON.stringify(extract, null, 2))
  log(`Wrote ${outPath}`)
}

main().catch((e) => {
  console.error('[pitch-recon] FAILED:', e.stack || e.message)
  process.exit(1)
})
