# Hustler Community Opportunities

**Discover opportunities. Connect with builders. Start building.**

A curated startup opportunity platform for the Hustler Community: a fast public
directory, a private admin workspace, a Groq-powered capture pipeline and a
Telegram bot that turns one LinkedIn post URL into individually reviewed listings.

This is not a generic job board. Every listing is tied to a real source, is
reviewed by a human before publication, and clearly separates source-supplied
facts from admin-verified information. Missing data says “Not specified” instead
of being invented.

- **Public site:** `/`, `/opportunities`, `/opportunities/[slug]`, `/categories`,
  `/categories/[slug]`, `/locations`, `/locations/[slug]`, `/about`, `/submit`,
  `/report`, `/privacy`, `/terms`
- **Admin workspace:** `/admin` (Overview, Capture, Opportunities, Pending
  review, Comments, Reports, Companies, Categories, Analytics, Settings)
- **One database:** Supabase Postgres, one shared server-side business-logic layer

---

## Product promise

> Find Your Next Opportunity. Start Building.

The homepage explains that opportunities come from founders, recruiters and
teams, and routes visitors to two primary actions: **Explore Opportunities** and
**Submit an Opportunity**. All public content is read live from the database.
There are no demo jobs in production.

---

## Feature summary

### Public discovery

- Full-text search across title, summary, skills and location.
- Combined filters: category, country, city, work mode, employment type,
  experience level and salary disclosed. Filters are a server-rendered GET form,
  so every result set has a shareable URL and works without JavaScript.
- Sorting by discovery date or original post date, with pagination.
- Filter counts, active-filter chips and one-click clearing.
- Opportunity cards and detail pages that show salary, experience, location,
  work mode, employment type, verification status, source and dates.
- “Not specified” for missing fields; source-supplied vs verified information is
  visually distinct.
- Sharing: copy link, native share (where supported), LinkedIn and WhatsApp using
  the real canonical URL.
- Application routes: external application URL, recruitment email (mailto with a
  prefilled subject plus a copyable message), original LinkedIn post and company
  careers page. The site never invents an email address or URL.
- Publication is blocked unless at least one usable application route exists,
  unless a documented exception is recorded.
- Anonymous outbound click tracking (`apply_click`, `email_click`, `source_click`,
  `careers_click`, `share`). These are outbound clicks, never “applications”.
- Public submission and reporting without an account. Submissions are always
  pending review; both forms use server-side validation, rate limiting, a
  honeypot and Cloudflare Turnstile when configured.

### Admin workspace

- Supabase Auth sign-in with HttpOnly cookies and an `admin_profiles` allowlist.
  No public signup. A valid Supabase user without an active profile is rejected.
- Overview: live counts, review queue, verification reminders, recent activity.
- Opportunities: list, search, filter, sort, create, edit, approve, publish,
  close, reopen, expire, archive, restore, reject and delete, with destructive
  confirmation and safe bulk actions.
- Pending review queue with a review link for every draft.
- Capture engine: URL-first LinkedIn ingestion, saved before any network call,
  with authorised retrieval when enabled, copied-text fallback, explicit retrieval
  and extraction states, retry on failure and preserved source on every failure.
- Duplicate protection: canonical source URL, LinkedIn activity ID, source post
  ID, existing application URL and similar role/company/date detection. Exact
  duplicates are blocked; potential duplicates are flagged and never auto-merged.
- AI extraction: Groq (Gemini remains available) through a server-side provider
  abstraction, Zod-validated JSON, nulls for absent fields, hardened prompt with
  untrusted source delimiters, retry/timeout/quota handling, per-role opening keys
  and optional coverage checking for long multi-role posts.
- Comments: professional, community-focused and short/conversational variants
  generated only from reviewed fields. Copy, edit, regenerate with version
  history, and manual-posted tracking. No listing URL before publication. No
  automatic LinkedIn engagement of any kind.
- Reports queue: start review, resolve with a note, dismiss, and close the listing
  when a report is confirmed.
- Companies and categories management, including activation and featured state.
- Analytics: views, outbound clicks, shares, searches and conversion-style ratios
  (never labelled as job applications).
- Settings: verification reminder window, source retention window, public form
  switches, AI provider, default currency, integration status, Telegram webhook
  registration and a retention purge action.

### Telegram capture bot

- Official Telegram Bot API only. No LinkedIn session cookies, proxy rotation,
  CAPTCHA solving or browser automation are used anywhere in the codebase.
- **URL-first:** the owner sends one LinkedIn post URL. The bot acknowledges it,
  saves the URL before any network call, retrieves the post through an authorised
  adapter, extracts every opening separately, and previews each draft.
- If the post cannot be retrieved through an authorised method, the URL is kept,
  the exact reason is recorded, the capture stays visible in the admin workspace,
  and the bot asks once for the copied post text (manual fallback).
- URL plus copied text in one message still works and is the fallback whenever
  retrieval is unavailable or not authorised.
- Inline buttons: **Approve & Publish**, **Save Draft**, **Reject**,
  **Regenerate Comment**, **Open Admin Review**.
- Webhook secret verification, numeric user-ID allowlist, update-ID deduplication,
  callback ownership validation and callback acknowledgement.
- The bot uses the same publication service as the admin UI, so the publish gate
  and lifecycle rules cannot be bypassed.

### Lifecycle and trust

- Statuses: Draft, Pending review, Published, Closed, Expired, Rejected, Archived.
- Separate verification statuses and separate timestamps: original post date,
  discovered, published, last verified, closed.
- AI never supplies system timestamps. “Posted today” can only be derived from a
  real original post date, never from discovery.
- Configurable verification reminder window; deadlines are flagged when expired.
- Closed listings are preserved with application routes disabled and JobPosting
  structured data removed.
- Database triggers enforce lifecycle transitions and mirror the publish gate as
  a second line of defence.

---

## Architecture

```
                        ┌──────────────────────────────┐
  Public visitor ──────▶│  Astro SSR on Vercel          │
                        │  (official adapter)           │
  Admin (browser) ─────▶│                              │
                        │  Public pages · Admin pages   │
  Telegram ────────────▶│  API routes (server only)     │
                        └──────────────┬───────────────┘
                                       │
                 ┌─────────────────────┼──────────────────────┐
                 ▼                     ▼                      ▼
        ┌────────────────┐   ┌──────────────────┐   ┌─────────────────┐
        │ Supabase       │   │ Groq API         │   │ Telegram Bot    │
        │ Postgres +     │   │ (server-side     │   │ API (official)  │
        │ Auth + RLS     │   │ extraction)      │   │                 │
        └────────────────┘   └──────────────────┘   └─────────────────┘
```

Request flow for a capture:

```
One LinkedIn post URL
  → ingestLinkedInUrl (validate, normalise, dedupe, persist the URL first)
  → authorised retrieval (or manual copied text when unavailable)
  → processCapture (claim, Groq, Zod validation, per-opening mapping)
  → one draft opportunity per opening in Pending review
  → admin / Telegram review
  → publishOpportunity (revalidate, publish gate, timestamps, comments)
  → public listing
```

### Stack

| Layer | Choice |
| --- | --- |
| Framework | Astro 5.18 with `output: 'server'` |
| Adapter | `@astrojs/vercel` 8.2 (Vercel serverless) |
| Interactive UI | React 19.2 islands (opportunity editor, comment studio) |
| Language | TypeScript |
| Database + auth | Supabase Postgres, Supabase Auth |
| AI | Groq (`openai/gpt-oss-120b` by default) through the `AIProvider` abstraction; Gemini remains available |
| Bot | Telegram Bot API (webhook) |
| Styling | One global design-token stylesheet, Space Grotesk |
| Validation | Zod |
| Unit/integration tests | Vitest |
| E2E | Playwright (desktop + mobile Chromium) |
| Deployment | Vercel, GitHub Actions CI |

No Kubernetes, Redis, Celery, microservices, vector database or separate backend.
Server-side business logic lives in `src/lib`, shared by pages, API routes and the
Telegram webhook.

---

## Folder structure

```
.
├── public/brand/                 Official logo/wordmark/community artwork
├── src/
│   ├── components/               Public + admin Astro components
│   │   └── admin/                React islands (editor, comment studio)
│   ├── layouts/                  PublicLayout, AdminLayout
│   ├── lib/
│   │   ├── ai/                   AIProvider interface + Groq/Gemini providers
│   │   ├── domain/               Types, lifecycle, validation, duplicates,
│   │   │                         comments, completeness, URL/format helpers
│   │   ├── linkedin/             Gated retrieval adapters, URL guards, JSON-LD parser
│   │   ├── services/             Capture, URL-first ingestion, publishing,
│   │   │                         comments, public, admin-opportunity, context
│   │   ├── store/                Store contract, Supabase + in-memory stores
│   │   ├── telegram/             Bot API client + update/callback service
│   │   ├── auth.ts               HttpOnly admin sessions
│   │   ├── env.ts                Runtime env resolution + config report
│   │   ├── http.ts               JSON helpers, same-origin checks
│   │   ├── rate-limit.ts         In-isolate rate limiting
│   │   └── turnstile.ts          Optional Turnstile verification
│   ├── pages/                    Public pages, admin pages, API routes
│   ├── styles/global.css         Design tokens + all component CSS
│   └── middleware.ts             Env resolution + admin route protection
├── supabase/
│   ├── migrations/0001_init.sql  Schema, enums, indexes, triggers, RLS
│   ├── migrations/0002_seed.sql  Categories + default settings
│   ├── migrations/0003_multi_opening.sql  Opening keys + publication numbering
│   ├── migrations/0004_capture_retrieval_enum.sql  Retrieval statuses
│   ├── migrations/0005_capture_retrieval_columns.sql  Retrieval + quality fields
│   ├── migrations/0006_retrieval_queue.sql  Atomic retry claim RPC
│   └── seed/first_admin.example.sql
├── tests/
│   ├── unit/                     Pure-domain tests
│   ├── integration/              Store-backed workflow tests
│   ├── e2e/                      Public smoke + credential-gated A–H workflows
│   └── helpers.ts                Fake AI, fake messenger, seeded stores
├── docs/BRAND.md                 Brand audit and token system
├── .env.example                  Environment template (no secrets)
├── .github/workflows/ci.yml      Lint, check, tests, build, public E2E
├── astro.config.mjs
├── eslint.config.js
├── playwright.config.ts
├── vitest.config.ts
├── vercel.json                   Cron schedule + security headers
└── package.json
```

---

## Local setup

### Prerequisites

- Node.js **20.19+** (developed on Node 24)
- npm 10+
- A Supabase project (free tier is enough)
- Optional: Groq API key, Telegram bot token, Turnstile keys

### Steps

```bash
git clone https://github.com/Pasha2308/jobposting.git
cd jobposting
npm ci
cp .env.example .env      # Windows: copy .env.example .env
# fill in the values you have
npm run dev
```

Open `http://localhost:4321`. With no Supabase credentials the public pages render
honest empty states and configuration notices; they never fabricate listings.

### Scripts

| Command | Purpose |
| --- | --- |
| `npm run dev` | Astro dev server on port 4321 |
| `npm run build` | Production build to `dist/` |
| `npm run preview` | Preview the production build |
| `npm run check` | `astro check` (TypeScript + template diagnostics) |
| `npm run lint` | ESLint over the repo |
| `npm test` | Vitest unit + integration suite |
| `npm run test:watch` | Vitest watch mode |
| `npm run e2e` | Playwright public journeys (desktop + mobile) |
| `npm run deploy` | Build and deploy with Astro to Vercel |
| `npm run db:push` | Reminder: apply SQL migrations in Supabase |

---

## Environment variables

Copy `.env.example` to `.env`. On Vercel, set the same keys under Project Settings → Environment Variables.
**Settings → Environment variables** (Production and Preview). Never commit a real
`.env`.

| Variable | Required | Exposure | Purpose |
| --- | --- | --- | --- |
| `PUBLIC_SITE_URL` | Yes | Public | Canonical origin for canonical tags, shares, sitemap, Telegram links. Example: `https://your-project.vercel.app` |
| `SUPABASE_URL` | Yes | Server | Supabase project URL |
| `SUPABASE_ANON_KEY` | Yes | Server | Used only server-side for password sign-in and token refresh |
| `SUPABASE_SERVICE_ROLE_KEY` | Yes | **Server secret** | Server-side data access. Never exposed to the browser |
| `AI_PROVIDER` | No | Server | `groq` (recommended), `gemini`, or `none` to disable extraction explicitly |
| `GROQ_API_KEY` | Recommended | **Server secret** | Groq API key |
| `GROQ_MODEL` | No | Server | Default `openai/gpt-oss-120b` |
| `GEMINI_API_KEY` | Optional | **Server secret** | Only when `AI_PROVIDER=gemini` |
| `GEMINI_MODEL` | No | Server | Default `gemini-2.5-flash` |
| `TELEGRAM_BOT_TOKEN` | Optional | **Server secret** | Token from BotFather |
| `TELEGRAM_WEBHOOK_SECRET` | Optional | **Server secret** | Random string; Telegram sends it as `X-Telegram-Bot-Api-Secret-Token` |
| `TELEGRAM_ADMIN_USER_IDS` | Optional | Server | Comma-separated numeric Telegram user IDs allowed to use the bot |
| `LINKEDIN_JSONLD_RETRIEVAL_ENABLED` | No | Server | `false` by default. Enables the isolated public JSON-LD adapter |
| `LINKEDIN_RETRIEVAL_AUTHORISED` | No | Server | `false` by default. Set only when legal/contractual authorisation exists |
| `CRON_SECRET` | Recommended | **Server secret** | Bearer secret for `/api/cron/retry-retrievals`; Vercel Cron sends it automatically |
| `PUBLIC_TURNSTILE_SITE_KEY` | Optional | Public | Turnstile site key |
| `TURNSTILE_SECRET_KEY` | Optional | **Server secret** | Turnstile secret key |

The app degrades gracefully: missing Supabase means the admin workspace reports
that it is not configured; missing Groq/Gemini preserves captures for retry;
missing Telegram disables capture registration; missing Turnstile skips that
check. It never simulates a successful integration.

`GET /api/health` returns a `configured` object showing which integrations are
present (booleans only, no secrets).

---

## Supabase setup

1. Create a project at [supabase.com](https://supabase.com) (free tier).
2. Open **SQL Editor** and run, in order:
   - `supabase/migrations/0001_init.sql`
   - `supabase/migrations/0002_seed.sql`
   - `supabase/migrations/0003_multi_opening.sql`
   - `supabase/migrations/0004_capture_retrieval_enum.sql`
   - `supabase/migrations/0005_capture_retrieval_columns.sql`
   - `supabase/migrations/0006_retrieval_queue.sql`
3. Copy from **Project Settings → API**:
   - Project URL → `SUPABASE_URL`
   - `anon` public key → `SUPABASE_ANON_KEY`
   - `service_role` key → `SUPABASE_SERVICE_ROLE_KEY` (server only)
4. Under **Authentication → Providers → Email**, **disable “Allow new users to
   sign up”**. There is no public signup.
5. Under **Authentication → URL Configuration**, set the Site URL to your deployed
   origin and add `http://localhost:4321` for local development.

### Schema

Tables: `admin_profiles`, `companies`, `categories`, `opportunities`,
`source_captures`, `generated_comments`, `reports`, `telegram_updates`,
`activity_logs`, `opportunity_events` (plus `app_settings` and the future
`company_sources`). UUID primary keys, foreign keys, unique constraints, indexes,
check constraints, lifecycle triggers and a publication gate trigger.

Key rules enforced in the database:

- `opportunities.canonical_source_key` is unique for live records.
- `source_captures.normalized_source_key` is unique while a capture is active.
- Published rows must have `published_at`.
- Lifecycle transitions are validated by `enforce_opportunity_transition`.
- `enforce_publishable_opportunity` mirrors the application-route and content
  checks required before publication.
- RLS exposes only live published opportunities and active taxonomy to the public.
  There are no public write policies. Raw source text has no public read path.

### First admin

1. **Authentication → Users → Add user**: create the owner with a strong password
   and confirm the email.
2. Copy the new user's UUID.
3. Edit and run `supabase/seed/first_admin.example.sql`, replacing the placeholder
   UUID and email.
4. Sign in at `/admin/login`.

A Supabase user without an active `admin_profiles` row is rejected by the server,
even if authentication succeeds.

### Migrations and seeds

The SQL files are plain Postgres and are applied through the Supabase SQL editor
or the Supabase CLI (`supabase db push`). Apply `0001` → `0006` in filename
order, **one file per execution**: `0004` adds enum values that `0005`/`0006`
use, and PostgreSQL cannot use a new enum value in the transaction that added
it. `0002_seed.sql` is idempotent and adds the initial categories and default
settings. Keep migrations append-only once a database is live.

`0001` defines `hc_array_to_text(text[])`, an `IMMUTABLE` wrapper used by the
GIN search index. `array_to_string()` and array casts are `STABLE`, so using
them directly in an index expression fails with PostgreSQL `42P17`. The wrapper
exists only for that reason.

---

## AI configuration (Groq by default)

1. Create an API key in the Groq console.
2. Set `GROQ_API_KEY` and optionally `GROQ_MODEL` (default
   `openai/gpt-oss-120b`).
3. Keep `AI_PROVIDER=groq`. Set it to `none` to disable extraction and work
   manually. `AI_PROVIDER=gemini` with `GEMINI_API_KEY` remains supported.

How extraction behaves:

- The source text is wrapped in explicit untrusted-content delimiters and the
  system instruction says to treat it as data, never as instructions. This is
  prompt-injection resistant by design.
- One post can contain many roles. The model returns an `openings` array and each
  distinct role becomes its own opportunity with its own application route.
- Multi-opening writes are resumable. Each opening is keyed by
  `(canonical_source_key, opening_key)`. If a write fails partway through a
  multi-opening post, retrying extraction reuses the openings already saved,
  refreshes any that are still `pending_review`, and creates only the missing
  ones. A retry never loses an opening and never creates a duplicate; a capture's
  own rows are also excluded from its duplicate check.
- For longer posts (four or more extracted openings) an optional second, cheap
  call lists every role mentioned. A mismatch is surfaced as a review warning;
  possible roles are never silently discarded. If the coverage call fails or the
  quota is exhausted, the successful extraction is kept.
- The model must return strict JSON. The response is parsed and validated with
  Zod. Missing booleans still reject the payload, but near-miss enum values are
  normalised (for example `day` → `exact`, `fulltime` → `full_time`) so one odd
  field can never discard every opening in a multi-role post.
- Salary shorthand is expanded to absolute amounts (`12–18 LPA` → `1200000`–
  `1800000`, currency `INR`, period `annual`). A general contact address is not
  treated as an application email.
- Missing fields become `null` (or empty lists). The model is never asked to guess
  salary, contact details or URLs.
- Timeouts, malformed JSON, quota errors and auth errors are mapped to safe error
  messages. The capture is preserved with status `extraction_failed` and can be
  retried.
- A deterministic completeness score and missing-field flags are computed from the
  persisted fields after extraction. They are advisory and admin-only; they do not
  bypass the publication gate.

---

## Telegram bot setup

1. In Telegram, open **@BotFather** and run `/newbot`. Save the token.
2. Generate a random webhook secret, for example:
   ```bash
   openssl rand -hex 32
   ```
3. Find your numeric Telegram user ID (send a message to a bot such as
   `@userinfobot`, or inspect an update). Only IDs in `TELEGRAM_ADMIN_USER_IDS`
   may use the bot.
4. Set `TELEGRAM_BOT_TOKEN`, `TELEGRAM_WEBHOOK_SECRET` and
   `TELEGRAM_ADMIN_USER_IDS` and redeploy.
5. Register the webhook either:
   - from **Admin → Settings → Telegram webhook → Register webhook** (recommended;
     uses the configured site URL and secret), or
   - manually:
     ```bash
     curl -X POST "https://api.telegram.org/bot<TOKEN>/setWebhook" \
       -H "content-type: application/json" \
       -d '{
         "url": "https://YOUR-SITE/api/telegram/webhook",
         "secret_token": "YOUR_WEBHOOK_SECRET",
         "allowed_updates": ["message", "callback_query"]
       }'
     ```
6. Send the bot one LinkedIn post URL. It acknowledges the submission, saves the
   URL, retrieves the post when an authorised adapter is enabled, and previews
   every extracted opening. If retrieval is unavailable, send the copied post
   text once. Use **Admin → Settings → Check status** to inspect `getWebhookInfo`.

Webhook endpoint: `POST /api/telegram/webhook`. It returns `503` when Telegram is
not configured, `403` for a bad secret, `400` for malformed updates, and
acknowledges callbacks. The bot never uses your LinkedIn session, CAPTCHA
bypasses, proxy rotation or a third-party scraping provider.

### URL-first ingestion and LinkedIn authorisation

The retrieval layer is modular (`src/lib/linkedin/`):

- **Default state:** automatic LinkedIn retrieval is **disabled**.
  `LINKEDIN_JSONLD_RETRIEVAL_ENABLED` and `LINKEDIN_RETRIEVAL_AUTHORISED` must
  both be `true` before the public JSON-LD adapter can make any request.
- The adapter sends no cookies, does not spoof a browser, follows no redirect
  outside LinkedIn, and stops on an authwall or rate limit instead of trying to
  bypass it. It has a timeout, response-size cap and SSRF/allowlist guards.
- Do not enable the flags unless you have legal/contractual authorisation to
  retrieve LinkedIn post pages. Public accessibility is not the same as permission.
- When retrieval is disabled or fails, the submitted URL is always preserved. The
  capture records `retrieval_status`, `retrieval_error_code`, HTTP status, attempt
  count and the next retry time. A failed capture stays visible and recoverable in
  **Admin → Captures**, with **Retry retrieval** and **Retry extraction** actions.
- Transient failures (timeout, network, 429, 5xx) are retried automatically with
  backoff, up to three retries after the first attempt. Access blocks
  (`login_required`) and missing content are not retried and request manual text.
- Raw source text, comments and retrieval metadata are retained for 90 days, then
  purged by the recovery job while the opportunity records and source references
  remain. Only captures that already produced an opportunity and reached a
  terminal review state (`approved`, `rejected`, `published`) are purged, so an
  old draft or a capture waiting for copied text never loses its source.

### Recovery cron

`GET /api/cron/retry-retrievals` requires `Authorization: Bearer $CRON_SECRET`.
It recovers captures stuck in `retrieving` or `extracting`, claims due retries
atomically with `FOR UPDATE SKIP LOCKED`, and runs the retention purge using the
configured `source_retention_days` (default 90).
`vercel.json` schedules it once daily (`0 3 * * *`), which is the supported
frequency on the Vercel Hobby plan. On Pro, change the schedule to run more often.
The endpoint returns `401` when `CRON_SECRET` is unset, so it can never be
triggered publicly.

---

## Vercel deployment

1. Push the repository to GitHub (`main`).
2. In Vercel, **Add New → Project** and import the repository.
3. The project builds with `npm run build` and the `@astrojs/vercel` adapter. Node
   22 is the runtime Vercel uses even if your local Node is newer.
4. Add every variable from the table above for **Production** (and **Preview** if
   needed). Production requires at least `PUBLIC_SITE_URL`, `SUPABASE_URL`,
   `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `AI_PROVIDER=groq`,
   `GROQ_API_KEY`, `TELEGRAM_BOT_TOKEN`, `TELEGRAM_WEBHOOK_SECRET`,
   `TELEGRAM_ADMIN_USER_IDS` and `CRON_SECRET`.
5. Set `PUBLIC_SITE_URL` to the final `https://<project>.vercel.app` origin (or
   custom domain) and redeploy so canonical links, sitemap and Telegram links are
   correct.
6. Register the Telegram webhook with the deployed origin:
   `https://<project>.vercel.app/api/telegram/webhook`, or use **Admin → Settings
   → Register webhook**.
7. `vercel.json` registers the daily recovery cron. Vercel sends
   `Authorization: Bearer $CRON_SECRET` automatically when `CRON_SECRET` exists on
   the project.

CLI deployment:

```bash
npx vercel login
npx vercel link
npx vercel --prod
```

Local build check:

```bash
npm run build
```

The build output is `.vercel/output` for the Vercel adapter. Do not commit `.env`
or `.vercel/`.

### GitHub deployment

The repository is `https://github.com/Pasha2308/jobposting` on `main`. CI runs on
every push/PR to `main`:

- `npm ci`
- `npm run lint`
- `npm run check`
- `npm test`
- `npm run build`
- Playwright public E2E on desktop and mobile Chromium

Authenticated E2E workflows are skipped unless credentials are supplied (see
Testing). No secrets are stored in the repository.

---

## Testing

### Unit and integration (Vitest)

```bash
npm test
```

Covers URL normalisation and slugging, duplicate detection and canonical source
keys, AI output validation, publication and application-route rules, category and
company validation, date normalisation, lifecycle transitions, comment safety and
versioning, the capture pipeline, multi-opening extraction (1, 3 and 5+ roles),
coverage mismatches, resuming a partially written multi-opening post without
losing or duplicating openings, retrieval guards/redirects/timeouts/size caps,
JSON-LD parsing (reposts, comments, malformed blocks), URL-first ingestion and
manual fallback, retry claims and stale recovery, completeness scoring, admin
session/allowlist rules, failed-AI retry, publishing, Telegram update
dedupe/allowlist/callbacks, reports, public submissions and click tracking.

The suite uses `MemoryStore`, a complete in-memory implementation of the `Store`
contract, so workflows run without credentials. Production uses `SupabaseStore`
with the same interface.

### Type checking and lint

```bash
npm run check
npm run lint
```

### Database migrations (plain PostgreSQL)

The migration chain is executed against a throwaway PostgreSQL 15 database. The
stub recreates only `auth.users` and the Supabase API roles; **never apply the
stub to the real Supabase project**. The smoke suite asserts multi-opening
inserts, duplicate blocking, automatic opening keys, publication numbering,
lifecycle guards, the publication gate, the search RPC, RLS, atomic retry claims
and the `IMMUTABLE` helper.

```bash
createdb hc_test
psql -d hc_test -v ON_ERROR_STOP=1 -f supabase/tests/00_supabase_stub.sql
for f in supabase/migrations/*.sql; do
  psql -d hc_test -v ON_ERROR_STOP=1 --single-transaction -f "$f"
done
psql -d hc_test -v ON_ERROR_STOP=1 -f supabase/tests/01_smoke.sql
```

CI runs exactly this in the `Database migrations (PostgreSQL 15)` job.

### End-to-end (Playwright)

```bash
npx playwright install chromium
npm run e2e
```

Public smoke journeys run against the local dev server with an empty database and
assert honest empty states. They cover the homepage promise and CTAs, the full
filter set, shareable filter URLs, taxonomy/about/legal pages, public submission
and report forms, branded 404, admin protection, sitemap and robots.

Authenticated workflows A–H require a seeded Supabase project and are skipped
otherwise. Set:

| Variable | Purpose |
| --- | --- |
| `E2E_BASE_URL` | Optional external deployed origin (otherwise a local dev server is started) |
| `E2E_SUPABASE_URL` | Confirms a live project is present |
| `E2E_ADMIN_EMAIL` | First admin email |
| `E2E_ADMIN_PASSWORD` | First admin password |
| `E2E_AI_CONFIGURED=1` | Enables capture/extraction workflows |
| `E2E_TELEGRAM_SECRET` | Enables Telegram webhook verification workflow |

Workflows: A capture → review, B publish through the validated gate, C published
listing in public search, D sharing and click tracking, E public report →
resolution, F close preserves the page but removes it from search, G Telegram
webhook rejects a bad secret/malformed update, H duplicate source is blocked.

> Unit/integration tests use the in-memory store and a fake AI provider, so they
> need no credentials. Run the authenticated E2E suite against a seeded Supabase
> project before going live. Live integration checks (Supabase schema, Groq model,
> Telegram bot identity and webhook, Vercel linkage) must be repeated after
> deployment; the repository cannot verify them on its own.

---

## Troubleshooting

| Symptom | Check |
| --- | --- |
| Public pages show “not configured” notices | `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` are set on the running environment |
| Admin login says the account is not authorised | The user exists in Supabase Auth **and** has an active row in `admin_profiles` |
| Login succeeds but redirects back | Cookies blocked, wrong `PUBLIC_SITE_URL`, or the project URL/anon key is wrong |
| Capture never extracts | `AI_PROVIDER=groq` and `GROQ_API_KEY` are set; check the capture's error and retry |
| Groq returns quota errors | Free-tier quota or billing; the capture is preserved and can be retried later |
| Telegram webhook never fires | Webhook URL is publicly reachable over HTTPS, `TELEGRAM_WEBHOOK_SECRET` matches, and your user ID is in `TELEGRAM_ADMIN_USER_IDS` |
| Telegram says “not configured” | All three Telegram variables are set and the site was redeployed |
| Publish is blocked | At least one usable application route is required; check the blocking list in the editor |
| Build fails on Vercel | `npm run build` locally; Vercel uses Node 22 even if local Node is newer |
| E2E can't start Chromium | `npx playwright install chromium` |
| Migration rejected | Run `0001_init.sql` through `0006_retrieval_queue.sql` in order on a fresh database |
| LinkedIn URL saved but extraction does not run | Retrieval is disabled by default. Send the copied post text, or enable both retrieval flags only when authorised |
| Recovery cron returns 401 | `CRON_SECRET` is unset on the project; set it and redeploy |

---

## Security

- Admin pages and admin APIs are guarded in `src/middleware.ts`; hiding a nav item
  is never treated as authorization.
- Admin sessions use Supabase Auth with `HttpOnly`, `SameSite=Lax` cookies
  (`Secure` in production). The browser never receives a Supabase localStorage
  session.
- All data access goes through the service-role client on the server. The service
  key is never imported by a React island or exposed to the client.
- RLS is enabled on every table. Public read policies exist only for live published
  opportunities and active taxonomy/category/company data.
- `source_captures` has no public read policy; raw post text is private.
- Mutating API routes require an authenticated admin, a same-origin request and
  validated input.
- Public forms use Zod validation, rate limiting, a honeypot and optional Turnstile.
- Telegram verifies the secret header in constant time, allowlists numeric user
  IDs, deduplicates update IDs, validates callback ownership and acknowledges
  callbacks.
- Output is escaped/sanitised; URLs must be http(s) with a dot and no embedded
  credentials; emails are validated before use in `mailto:` links.
- AI output is treated as untrusted until Zod validation and mapping succeed.
- Errors returned to clients are safe summaries. Stack traces and secrets are not
  returned.
- `.env`, `.dev.vars`, keys and certificates are gitignored. No secrets are in the
  repository or Git history.

---

## Free-tier notes

| Service | Free tier | Practical limit |
| --- | --- | --- |
| Vercel Hobby | Personal projects; one cron run per day | Fine for this workload; Pro allows frequent recovery runs |
| Supabase Free | 500 MB database, 50k MAU auth, pauses after inactivity | Enough for thousands of listings; raw source retention keeps text bounded |
| Groq free tier | Rate-limited requests | Capture is human-triggered, not bulk; failures stay queued for retry |
| Telegram Bot API | Free | No message-volume cost |
| Cloudflare Turnstile | Free | Optional; forms still have honeypot + rate limiting |
| GitHub Actions | Free minutes for public repos | CI runs lint/check/test/build plus public E2E |

Graceful degradation preserves data: a failed AI call leaves the capture, a missing
integration disables only its feature, and the public site shows honest empty
states instead of fabricated content.

### Data retention

`source_retention_days` (default 90) controls how long raw capture text is kept.
The daily recovery job purges raw text, stored extraction payloads, source
comments and retrieval metadata once a capture is older than that window **and**
it has already produced an opportunity in a terminal review state (`approved`,
`rejected`, `published`). Opportunity rows and source references stay intact, and
a draft or a capture awaiting copied text is never purged. Use **Admin →
Settings → Source retention → Purge expired source text** for a manual purge.
Both paths are logged to `activity_logs`.

---

## Brand

The palette, typography, logo usage and voice come from the real Hustler Community
brand. See [`docs/BRAND.md`](docs/BRAND.md) for the audit, official assets, tokens
and accessibility rules. Official assets live in `public/brand/`.

---

## Known limitations

- URL-only LinkedIn retrieval is implemented but **disabled by default** pending
  legal/contractual authorisation. Until both retrieval flags are enabled, a
  LinkedIn URL is preserved and the bot asks for the copied post text.
- Restricted or sign-in-only posts cannot be retrieved without the prohibited use
  of a personal LinkedIn session. They always fall back to manual text.
- Image-only posts expose no public text; they are reported as `no_content` rather
  than guessed.
- Vercel Hobby allows one cron run per day. Frequent automatic retries require Pro
  or a manual **Retry retrieval** from the admin workspace.
- ATS sync (`company_sources`) is schema-ready but intentionally not automated;
  there is no ATS integration UI yet.
- The in-process rate limiter is per serverless instance. For strict global limits,
  move the counters to a shared store (e.g. a Postgres table or KV).
- No custom domain is required; if you add one, update `PUBLIC_SITE_URL` and
  redeploy.
- New extraction fields (education, benefits, languages, recruiter, completeness
  flags) are admin-only and are not rendered on public listing pages.
