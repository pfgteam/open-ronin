# Environment variables

Copy `web/.env.example` to `web/.env.local` and fill it in. Only the **Required** group is needed for the app to boot and for the setup wizard to run; each other group turns on one integration. Unset integrations show a "not configured" state instead of failing. Typed mirror: `web/env.d.ts`.

Never commit `.env.local`. The service role key, OAuth secrets and API keys are server-only; only `NEXT_PUBLIC_*` values reach the browser.

## Required

| Variable | What it is | Where to get it |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase API URL | Local: `supabase status` (API URL). Hosted: Project Settings › API |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Public anon key | Same place (anon / publishable key) |
| `SUPABASE_SERVICE_ROLE_KEY` | Server-only key for trusted jobs, the setup gate and `pnpm setup:apply` | Same place (service_role / secret key). Server only |
| `NEXT_PUBLIC_APP_URL` | Base URL of the app (`http://localhost:3000` locally) | Your domain |
| `NEXT_PUBLIC_ALLOWED_EMAIL_DOMAINS` | Comma-separated sign-in domains (`org.allowed_email_domains`) | `open-ronin.config.yaml` |
| `CRON_SECRET` | Bearer token Vercel Cron sends to `/api/cron/*` | `openssl rand -hex 32` |
| `INGEST_API_KEY` | Bearer token for `/api/ingest/*` webhooks (n8n, recorders) | `openssl rand -hex 32` |

Optional in the same group: `NEXT_PUBLIC_ORG_NAME` (name shown before the database answers), `OPEN_RONIN_CONFIG` (path to `open-ronin.config.yaml` if it is not in the repo root).

## Email

| Variable | Needed for |
|---|---|
| `AUTH_EMAIL_ENABLED` | `true` turns on the login page's "Email me a sign-in link" and "Forgot password?". Set it only after Supabase Auth has a working email provider (Authentication › Emails › SMTP Settings). Email + password sign-in never needs it. |
| `RESEND_API_KEY` | Sending invites, notifications, form alerts |
| `RESEND_FROM_EMAIL` | From address (`email.from` in the config) |

Supabase Auth sends its own sign-in emails; point its SMTP settings at the same provider in production.

## Google

| Variable | Needed for |
|---|---|
| `GOOGLE_OAUTH_CLIENT_ID`, `GOOGLE_OAUTH_CLIENT_SECRET`, `NEXT_PUBLIC_GOOGLE_OAUTH_CLIENT_ID` | Google Calendar sync. Sign-in with Google is configured in Supabase Auth, not here: the login page shows the Google button by itself once that provider is enabled (see SETUP.md › Sign-in methods). |
| `GOOGLE_SERVICE_ACCOUNT_JSON` | Reading Google Sheets for dashboards |
| `METRICS_SPREADSHEET_ID` | The metrics sheet the dashboards read |

## AI providers

Any subset. The provider registry (`web/src/lib/providers`) shows which are configured. Spend limits live in Admin and in `ai.spend_limit_*` of the config.

`ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `GOOGLE_AI_API_KEY`, `XAI_API_KEY`, `PERPLEXITY_API_KEY`, `IDEOGRAM_API_KEY`, `STABILITY_API_KEY`, `BFL_API_KEY`, `RECRAFT_API_KEY`, `LEONARDO_API_KEY`, `HEYGEN_API_KEY`, `RUNWAY_API_KEY`, `KLING_ACCESS_KEY`, `KLING_SECRET_KEY`, `LUMA_API_KEY`, `SYNTHESIA_API_KEY`, `ELEVENLABS_API_KEY`, `SUNO_API_KEY`, `OPUSCLIP_API_KEY`, `DESCRIPT_API_KEY`, `CANVA_CLIENT_ID`, `CANVA_CLIENT_SECRET`, `DEEPGRAM_API_KEY`, `ASSEMBLYAI_API_KEY`, `PEXELS_API_KEY`, `UNSPLASH_ACCESS_KEY`, `METRICOOL_API_KEY`.

`CLASSIFIER_AI_URL`, `CLASSIFIER_AI_KEY`: optional external call classifier used by call ingest.

## CRM (GoHighLevel)

`GHL_CLIENT_ID`, `GHL_CLIENT_SECRET`, `GHL_REDIRECT_URI` (`<app url>/api/ghl/callback`), `GHL_API_BASE`, `GHL_AUTHORIZE_URL`, `GHL_SCOPES` (defaults apply when blank), `GHL_TOKEN_ENC_KEY` (64 hex chars; also encrypts stored Google refresh tokens).

## Airtable (optional)

Open Ronin stores its data natively. The Airtable mirror exists for teams migrating from Airtable.

`AIRTABLE_PAT` (or legacy `AIRTABLE_API_KEY`), `AIRTABLE_WORKSPACE_ID`, `AIRTABLE_OPPS_TABLE`, `AIRTABLE_OPPS_CLIENTS_TABLE`, and one `AIRTABLE_BASE_<KEY>` per base listed in `web/src/lib/data/index.ts` (for example `AIRTABLE_BASE_CLIENT_CENTRAL`). Unset bases resolve to an empty id and their pages show the not-configured state.

## Scrapers, comms, meetings

| Variable | Needed for |
|---|---|
| `APIFY_TOKEN` | Lead / media / acquisition scrapers |
| `META_WEBHOOK_VERIFY_TOKEN` | Facebook / Instagram messaging webhook verification |
| `ZOOM_ACCOUNT_ID`, `ZOOM_CLIENT_ID`, `ZOOM_CLIENT_SECRET` | Zoom recordings and transcripts |

## Public forms and proof analytics

`NEXT_PUBLIC_TURNSTILE_SITE_KEY`, `TURNSTILE_SECRET_KEY` (Cloudflare Turnstile on public forms), `PROOF_EVENT_SALT` (random string used to hash visitor IPs).

## Admin › Dev dashboard (optional, read-only tokens)

`GITHUB_TOKEN`, `VERCEL_TOKEN`, `VERCEL_PROJECT_ID`, `VERCEL_TEAM_ID`, `SUPABASE_ACCESS_TOKEN`, `SUPABASE_PROJECT_REF`, `N8N_API_URL`, `N8N_API_KEY`, `SENTRY_DSN`.

## Skills worker (`worker/`)

The optional skills worker has its own `worker/.env.example` (Supabase URL + service role key + one AI key). It is not needed for the web app.
