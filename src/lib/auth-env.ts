/**
 * Startup validation for the Auth.js environment variables.
 *
 * Auth.js answers with an opaque 500 ("problem with the server configuration")
 * when its config assertions fail, and the underlying reason is invisible in a
 * minified production build. These checks name the offending variable in the
 * runtime log and never print a value.
 */

type EnvCheck = { key: string; ok: boolean; reason?: string }

const WRAPPED_IN_QUOTES = /^(".*"|'.*')$/s
const GOOGLE_CLIENT_ID = /^[\w-]+\.apps\.googleusercontent\.com$/

function inspect(
  key: string,
  raw: string | undefined,
  format?: (value: string) => string | undefined,
): EnvCheck {
  if (!raw) return { key, ok: false, reason: 'missing-or-empty' }
  if (WRAPPED_IN_QUOTES.test(raw))
    return { key, ok: false, reason: 'wrapped-in-quotes' }
  if (/[\r\n]/.test(raw)) return { key, ok: false, reason: 'contains-newline' }
  if (raw !== raw.trim())
    return { key, ok: false, reason: 'surrounding-whitespace' }
  const problem = format?.(raw)
  return problem ? { key, ok: false, reason: problem } : { key, ok: true }
}

export function checkAuthEnv(env: NodeJS.ProcessEnv = process.env): EnvCheck[] {
  return [
    inspect('AUTH_SECRET', env.AUTH_SECRET),
    inspect('AUTH_GOOGLE_ID', env.AUTH_GOOGLE_ID, (value) =>
      GOOGLE_CLIENT_ID.test(value)
        ? undefined
        : 'not-an-apps-googleusercontent-com-id',
    ),
    inspect('AUTH_GOOGLE_SECRET', env.AUTH_GOOGLE_SECRET, (value) =>
      value.startsWith('GOCSPX-') ? undefined : 'missing-GOCSPX-prefix',
    ),
  ]
}

/** Logs one JSON line naming every failed check. Never logs a value. */
export function reportAuthEnv(): void {
  const failed = checkAuthEnv().filter((check) => !check.ok)
  const line = JSON.stringify({
    tag: 'auth-env-check',
    ok: failed.length === 0,
    failed: failed.map((check) => `${check.key}:${check.reason}`),
  })
  if (failed.length) console.error(line)
  else console.log(line)
}
