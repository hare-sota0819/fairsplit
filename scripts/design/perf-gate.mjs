// Landing-page performance gate — Task 8 of the design-overhaul-rev2 plan
// (the design plan §Task 8 Step 1).
//
// The landing route runs the backdrop (Task 6: layered CSS radial/conic
// gradients drifting via transform/opacity keyframes) at full
// `--art-strength`. This is the one route where that animation is
// guaranteed to be live and continuous, so it is the gate's target.
//
// Method: boot a production build, open the landing page in a fresh
// context, throttle the CPU 4x via the CDP `Emulation` domain (simulates a
// low-end device — a real accessibility/perf concern, not just a nicety),
// let entrance choreography finish, then count animation frames via a
// requestAnimationFrame loop running for 5 real seconds. Average fps must
// be >= 55. Below that, the fix is to cut animation layers (fewer gradient
// stops, longer durations, confirm the offscreen/hidden-tab pause already
// wired in Task 6) — not to loosen this threshold.
//
// Usage: node scripts/design/perf-gate.mjs
// Requires: a local Postgres reachable via DATABASE_URL (.env), migrated
// (only because `next build` needs Prisma to generate against a reachable
// schema — the landing route itself does no DB reads).
import { chromium } from '@playwright/test'
import { spawn } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.join(__dirname, '../..')

const PORT = 34000 + Math.floor(Math.random() * 4000)
const BASE_URL = `http://localhost:${PORT}`
const CPU_THROTTLE_RATE = 4
const MEASURE_MS = 5000
const SETTLE_MS = 1500 // entrance ladder: 5 steps * 150ms delay + 400ms duration ~= 1150ms
const FPS_FLOOR = 55

function scratchDatabaseUrl(devUrl, suffix) {
  const u = new URL(devUrl)
  const name = u.pathname.replace(/^\//, '')
  u.pathname = `/${name}_${suffix}`
  return u.toString()
}
const devDatabaseUrl =
  process.env.DATABASE_URL ??
  'postgresql://fairsplit:localdev@localhost:5432/fairsplit?schema=public'
const scratchUrl = scratchDatabaseUrl(devDatabaseUrl, 'design_perf_gate_e2e')

function run(cmd, args, env) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, {
      cwd: ROOT,
      stdio: 'inherit',
      env: { ...process.env, ...env },
    })
    child.on('exit', (code) =>
      code === 0 ? resolve() : reject(new Error(`${cmd} exited ${code}`)),
    )
  })
}

async function waitForServer(url, timeoutMs) {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(url)
      if (res.status < 500) return
    } catch {
      // not up yet
    }
    await new Promise((r) => setTimeout(r, 500))
  }
  throw new Error(`server at ${url} did not become ready in time`)
}

/** Counts real animation frames over `ms` wall-clock milliseconds via rAF. */
async function countFrames(page, ms) {
  return page.evaluate(
    (durationMs) =>
      new Promise((resolve) => {
        let count = 0
        const start = performance.now()
        function tick() {
          count += 1
          if (performance.now() - start < durationMs) {
            requestAnimationFrame(tick)
          } else {
            resolve(count)
          }
        }
        requestAnimationFrame(tick)
      }),
    ms,
  )
}

async function main() {
  console.log('== Resetting scratch database ==')
  await run('bash', ['scripts/e2e-db-reset.sh'], { DATABASE_URL: scratchUrl })

  console.log('== Building the app (perf must reflect production output) ==')
  await run('npx', ['next', 'build'], {
    DATABASE_URL: scratchUrl,
    DIRECT_URL: scratchUrl,
  })

  console.log('== Starting the server ==')
  // NOT `stdio: 'inherit'`. If this process's own stdout is a pipe (e.g.
  // this script's invoker piping to `tail`, or any output-capturing
  // runner), an inherited fd stays open in this long-lived child even after
  // THIS process exits/crashes — the caller then hangs waiting for EOF that
  // never comes until the server is separately reaped. Piped + drained
  // instead, so the parent's own stdout is never entangled with the
  // server's lifetime. `detached: true` puts it in its own process group so
  // the SIGKILL fallback below can take the whole group, not just the
  // immediate `npx` wrapper (which historically has left a bare
  // `next-server` behind — see screenshot-sweep.mjs's PORT-randomization
  // comment for the same underlying leak).
  const server = spawn('npx', ['next', 'start', '-p', String(PORT)], {
    cwd: ROOT,
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: true,
    env: {
      ...process.env,
      DATABASE_URL: scratchUrl,
      DIRECT_URL: scratchUrl,
      FXRATESAPI_BASE_URL: 'http://127.0.0.1:9',
      FRANKFURTER_BASE_URL: 'http://127.0.0.1:9',
    },
  })
  server.stdout.on('data', (d) => process.stdout.write(d))
  server.stderr.on('data', (d) => process.stderr.write(d))

  let fps
  try {
    await waitForServer(BASE_URL, 60_000)
    const browser = await chromium.launch()
    const context = await browser.newContext({ viewport: { width: 390, height: 844 } })
    const page = await context.newPage()
    const client = await context.newCDPSession(page)

    console.log(`== Throttling CPU ${CPU_THROTTLE_RATE}x ==`)
    await client.send('Emulation.setCPUThrottlingRate', { rate: CPU_THROTTLE_RATE })

    await page.goto(BASE_URL)
    await page.waitForTimeout(SETTLE_MS)

    console.log(`== Counting frames for ${MEASURE_MS}ms ==`)
    const frames = await countFrames(page, MEASURE_MS)
    fps = frames / (MEASURE_MS / 1000)

    await browser.close()
  } finally {
    // Kill the whole detached process group (negative pid), not just the
    // `npx` wrapper — `next start` forks its own `next-server` child, and
    // SIGTERM to only the wrapper has been observed to leave that child
    // running. SIGKILL, not SIGTERM: this run is over either way, and a
    // graceful-shutdown hang here is exactly the failure mode being guarded
    // against.
    try {
      process.kill(-server.pid, 'SIGKILL')
    } catch {
      // already gone
    }
  }

  console.log(`\nframes: ${fps * (MEASURE_MS / 1000)} over ${MEASURE_MS}ms`)
  console.log(`avg fps @ ${CPU_THROTTLE_RATE}x CPU throttle: ${fps.toFixed(1)}`)
  console.log(`floor: ${FPS_FLOOR}fps`)

  if (fps < FPS_FLOOR) {
    console.error(`\nperf-gate.mjs: FAILED (${fps.toFixed(1)}fps < ${FPS_FLOOR}fps)`)
    process.exit(1)
  }
  console.log('\nperf-gate.mjs: PASSED')
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
