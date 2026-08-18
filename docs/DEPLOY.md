# Deploying FairSplit to Vercel + Supabase

This guide takes the app from the GitHub repo to a public URL at
`https://<project>.vercel.app`, backed by Supabase Postgres, with Google
login working. Everything repo-side is already done; the numbered steps in
"One-time manual setup" are the only clicks you need to make.

- **Hosting**: Vercel (free Hobby tier)
- **Database**: Supabase Postgres (free tier)
- **Migrations**: run automatically on every Vercel build
  (`prisma migrate deploy` — never `migrate dev` in production)

---

## 1. Environment variables for Vercel

Enter these in Vercel under **Settings → Environment Variables** (step-by-step
below). Names must match exactly.

| Name | Required | Value / where it comes from |
| --- | --- | --- |
| `DATABASE_URL` | Yes | Supabase **Transaction pooler** connection string (port **6543**), with `?pgbouncer=true` appended. From Supabase: **Connect → Connection String → Transaction pooler**. Serverless functions need this pooled URL — do NOT use the direct connection here. |
| `DIRECT_URL` | Yes | Supabase **Session pooler** connection string (port **5432**). From the same Connect dialog, **Session pooler** tab. Used only by `prisma migrate deploy` during the build; migrations cannot run through the transaction pooler. |
| `AUTH_SECRET` | Yes | Generate once on your machine: `openssl rand -base64 32` (or `npx auth secret`). Any long random string; never reuse the dev placeholder. |
| `AUTH_GOOGLE_ID` | Yes | Google Cloud Console OAuth client ID (ends in `.apps.googleusercontent.com`). See step 3. |
| `AUTH_GOOGLE_SECRET` | Yes | Google Cloud Console OAuth client secret (same screen as the ID). |
| `FRANKFURTER_BASE_URL` | No | Leave unset. The app defaults to the public Frankfurter exchange-rate API. Only set this if you later self-host Frankfurter. |
| `GEMINI_API_KEY` | For receipt scanning | Google AI Studio key (aistudio.google.com/apikey). Read only in the server route; it never reaches the browser. **Enable billing on the Google Cloud project first** — the free tier allows 20 `generateContent` requests per day for the whole project, which is less than one travel day for one person. Without this variable the scan button reports that scanning is not set up and manual entry still works. |
| `SUPABASE_URL` | For receipt photos | `https://<project>.supabase.co`. Storage REST endpoint for receipt images. |
| `SUPABASE_SERVICE_ROLE_KEY` | For receipt photos | Supabase **service role** key (Project Settings → API). Server-only: it bypasses RLS, so it must never appear in a client bundle or a `NEXT_PUBLIC_` variable. Without the two Supabase variables, scanning still parses receipts — the expense simply carries no photo. |

Not needed on Vercel (documented so nobody adds them by mistake):

- `AUTH_URL` — Auth.js v5 infers the deployment URL from request headers on
  Vercel. Only set it if the app ever moves behind a custom proxy.
- `AUTH_TRUST_HOST` — automatically true on Vercel. It is only required for
  self-hosted production (e.g. `next start` behind nginx).

Env audit: `process.env` is read in exactly seven places in this repo —
`DATABASE_URL` (src/lib/prisma.ts), `FRANKFURTER_BASE_URL`
(src/lib/rates/frankfurter.ts), `GEMINI_API_KEY`
(src/app/api/receipts/parse/route.ts), `SUPABASE_URL` and
`SUPABASE_SERVICE_ROLE_KEY` (src/lib/receipts/storage.ts), `NODE_ENV`
(framework-managed), and `CI` (Playwright config, local/CI only). The three
new ones are read only in server modules; none is `NEXT_PUBLIC_`. Auth.js additionally reads `AUTH_SECRET`,
`AUTH_GOOGLE_ID`, `AUTH_GOOGLE_SECRET` internally. Nothing is read in code
that is missing from the table above.

---

## 2. One-time manual setup

### A. Supabase — get the two connection strings

1. Go to [supabase.com/dashboard](https://supabase.com/dashboard) and open
   your project.
2. Click the **Connect** button at the top of the dashboard.
3. In the dialog, find the **Transaction pooler** string (port **6543**).
   Copy it, replace `[YOUR-PASSWORD]` with your database password, and append
   `?pgbouncer=true` at the end. This is `DATABASE_URL`.
4. In the same dialog, find the **Session pooler** string (port **5432**).
   Copy it and replace the password the same way. This is `DIRECT_URL`.
5. If you don't know the database password, reset it under
   **Project Settings → Database → Reset database password** first.

### B. GitHub — repository

Already done: the code is pushed to the private repo
**`hare-sota0819/splitmate`** on GitHub. Nothing to click here.

### C. Vercel — import and first deploy

1. Go to [vercel.com](https://vercel.com) and log in.
2. Click **Add New… → Project**.
3. Under **Import Git Repository**, connect your GitHub account if prompted
   (install the Vercel GitHub app and grant it access to `splitmate`), then
   click **Import** next to `splitmate`.
4. Framework preset should auto-detect **Next.js**. Do not change the build
   command — the repo's `vercel.json` already sets it (it runs database
   migrations before each build).
5. Before clicking Deploy, open the **Environment Variables** section and add
   every variable from the table in section 1 (except `AUTH_GOOGLE_ID` /
   `AUTH_GOOGLE_SECRET`, which you'll get in step D — you can add them after).
6. Click **Deploy** and wait for the build to finish.
7. Note your app URL, shown on the project page as
   `https://<project>.vercel.app`. You'll need it for step D.

### D. Google Cloud Console — OAuth client for Google login

1. Go to [console.cloud.google.com](https://console.cloud.google.com) and
   select (or create) a project.
2. Navigate to **APIs & Services → OAuth consent screen**. If not configured
   yet: choose **External**, fill in the app name and your email, and save.
   (While the consent screen is in **Testing** mode, add your Google account
   — and any testers' accounts — under **Test users**, or publish the app.)
3. Navigate to **APIs & Services → Credentials**.
4. Click **+ Create credentials → OAuth client ID**.
5. Application type: **Web application**.
6. Under **Authorized JavaScript origins**, add:
   `https://<project>.vercel.app` (your URL from step C-7, no trailing slash).
7. Under **Authorized redirect URIs**, add exactly:
   `https://<project>.vercel.app/api/auth/callback/google`
8. Click **Create** and copy the **Client ID** and **Client secret**.
9. Back in Vercel: **Settings → Environment Variables**, add
   `AUTH_GOOGLE_ID` and `AUTH_GOOGLE_SECRET` with those values.
10. Redeploy so the new variables take effect: **Deployments** tab → newest
    deployment → **⋯ menu → Redeploy**.

---

## 3. Migrations in production

- Every Vercel build runs `prisma migrate deploy` (configured in
  `vercel.json`) against `DIRECT_URL`. It applies any committed migrations
  that aren't yet in the database and is a no-op otherwise.
- Never run `prisma migrate dev` against the Supabase database — it is a
  development command that can reset data.
- One-off manual apply (rarely needed, e.g. to pre-create tables before the
  first deploy): from the repo, with `DIRECT_URL` set to the Session pooler
  string:

  ```bash
  DIRECT_URL="postgres://...:5432/postgres" npx prisma migrate deploy
  ```

There is no seed script in this repo, and the Playwright test setup only runs
against a locally started server — nothing writes test data to production.

---

## 4. Production smoke checklist

Do these in order on the deployed URL, after steps A–D are complete.
You'll need: your normal browser + one incognito window (second account).

- [ ] 1. Open `https://<project>.vercel.app` — the sign-in page loads
      (no error screen).
- [ ] 2. Sign in with **Google**. You land in the app, signed in.
- [ ] 3. Sign out. Create a second account with **email + password** in an
      incognito window (this account stays signed in for step 6).
- [ ] 4. In your Google-account browser: create a group (pick name, currency,
      rate mode). The group home page opens.
- [ ] 5. Open the group's **Settings** and copy the invite link.
- [ ] 6. Paste the invite link in the incognito window (email account) and
      join the group — pick/claim a member slot. Group home shows both
      members.
- [ ] 7. Add an expense with 2–3 **items**, and assign the items to different
      members (use the assignment accordion). Save, then open the expense —
      items and the split look right.
- [ ] 8. Record an **exchange** (group → Exchange screen: amount paid, amount
      received, date). Then check the home screen shows the **wallet card**
      for that currency with remaining cash.
- [ ] 9. Open the **Status** tab — net balances for both members and the cash
      column render, numbers are plausible (the expense from step 7 shows
      up).
- [ ] 10. Reload the page once more — still signed in, no errors.

If any step fails, check **Vercel → your project → Logs** for the error
before changing anything.

---

## 5. Post-deploy notes & risks

- **Cold starts**: on the free tier, the first request after idle takes a few
  seconds (serverless cold start + DB connect). Normal, not a bug.
- **Supabase free-tier pausing**: free projects are **paused after ~1 week of
  inactivity**. The app will error until you click **Restore** in the
  Supabase dashboard. If the app suddenly 500s after a quiet week, check this
  first.
- **Connection limits**: the transaction pooler absorbs serverless connection
  churn, but free-tier pooler client limits are finite. At trip-group scale
  this is a non-issue; if you ever see "too many connections", lower traffic
  concurrency or upgrade the DB.
- **Preview deploys share the production database.** Every branch/PR deploy
  on Vercel uses the same env vars, runs migrations, and writes to the same
  Supabase DB. Fine while it's just you; revisit before opening the repo to
  collaborators.
- **Custom domain later**: adding one means also adding it to Google's
  Authorized origins + redirect URIs (step D-6/7 with the new domain).
- **Secrets hygiene**: `.env` is gitignored and repo history contains no real
  secrets (verified 2026-08-01; only local-dev placeholders in
  `.env.example`). Keep it that way — production values live only in Vercel.

### F. Receipt photo storage (Supabase Storage)

Only needed if receipt photos should be kept; parsing works without it.

1. Supabase dashboard → **Storage** → **New bucket**, name it `receipts`, and
   leave **Public bucket** OFF. It must stay private: every read is served by
   `/api/receipts/image`, which checks group membership and then mints a
   short-lived signed URL.
2. Do **not** add RLS policies for this bucket expecting them to authorise app
   users. Supabase RLS evaluates a Supabase JWT, and this app authenticates
   with Auth.js, so the database cannot see who the caller is. Access control
   lives in the route (see OPEN_QUESTIONS.md #3).
3. Set `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` in Vercel.
4. Verify it end to end. The app's own check does the whole path against the
   real bucket — it creates the bucket private if it is missing, uploads a real
   photo, reads it back through a signed URL with no auth header, and proves the
   object is unreachable without that signature:

   ```bash
   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... \
     npx vitest run src/lib/receipts/storage.live.test.ts
   ```

   It skips itself when those variables are absent, so `verify.sh` is unaffected.

**Both key formats work, but not the same way.** Supabase's newer
`sb_secret_...` keys are *not* JWTs, and sending one in `Authorization: Bearer`
makes the platform try to parse it as one and reject the request; the credential
must travel in the `apikey` header. `src/lib/receipts/storage.ts` picks by key
shape — `apikey` always, `Authorization` only for a legacy JWT-shaped
`service_role` key — so either format works without configuration.

**These are usually *sensitive* variables in Vercel.** If you mark them so,
`vercel env pull` returns the literal string `[SENSITIVE]` rather than the
value, and nothing local can read them back. Keep a copy in `.env.local`
(gitignored) if the storage path needs to be verified from a workstation.

Objects are stored as `<groupId>/<uuid>.jpg` and only the resized upload is
kept — originals are never sent. Deleting a group deletes its objects.
