# Setting up Open Ronin

This is the by-hand version of [INSTALL.md](../INSTALL.md). If you install with an AI coding agent, follow INSTALL.md instead; it runs these same commands.

## What you need

- Git, Node.js 20 or newer (CI uses 22), pnpm 10 or newer (`corepack enable`)
- The [Supabase CLI](https://supabase.com/docs/guides/local-development/cli/getting-started)
- Docker Desktop, for the local database

## 1. Describe your organisation (optional but recommended)

Answer the questionnaire in `install/questionnaire.md` (or have your agent do it) and save the answers as `open-ronin.config.yaml` in the repo root, using `install/open-ronin.config.example.yaml` as the format. The setup wizard and `pnpm setup:apply` both read this file. No secrets go in it.

## 2. Database

Local (Docker):

```bash
supabase start                 # from the repo root; applies supabase/migrations and loads supabase/seed.sql
supabase status -o env         # prints API_URL, ANON_KEY, SERVICE_ROLE_KEY for step 3
```

`supabase/seed.sql` is fictional demo data (4 clients, contacts, a goal tree). Skip it with `supabase db reset --no-seed`.

Hosted Supabase:

```bash
supabase login
supabase link --project-ref <your-project-ref>
supabase db push               # applies every migration in supabase/migrations
supabase db push --include-seed   # only if you want the demo data
```

Migrations:

| File | What it holds |
|---|---|
| `20261111000000_baseline.sql` | The whole schema: tables, functions, row-level security, storage buckets |
| `20261111000100_reference_data.sql` | Vocabularies the app expects (modules, statuses, notification kinds, boards, pipeline stages) |
| `20261111000200_tenant_config.sql` | `org_settings`, `service_lines`, the setup RPCs and the sign-in domain gate |

New schema changes go in new timestamped files (`supabase migration new <name>`); run `pnpm migrations:manifest` in `web/` afterwards.

## 3. Environment

```bash
cp web/.env.example web/.env.local
```

Fill in the Required block (see [ENV.md](ENV.md)): Supabase URL and keys from step 2, `NEXT_PUBLIC_APP_URL`, `NEXT_PUBLIC_ALLOWED_EMAIL_DOMAINS` (same list as `org.allowed_email_domains`), and random `CRON_SECRET` / `INGEST_API_KEY` (`openssl rand -hex 32`).

## 4. Run it

```bash
cd web
pnpm install
pnpm dev                       # http://localhost:3000
```

Checks (the same gates CI runs):

```bash
pnpm typecheck && pnpm lint && pnpm test && pnpm build
cd .. && bash scripts/ui-audit.sh
```

## 5. First-run setup

Either way below ends with `org_settings.setup_completed_at` set; until then every signed-in page redirects to `/setup`.

**Wizard.** Open http://localhost:3000, create an account (`/auth/signup`), and you land on `/setup`. On a fresh install the first person to finish the wizard becomes the admin. The wizard prefills from `open-ronin.config.yaml` when it finds one in the repo root (or at `OPEN_RONIN_CONFIG`), shows the exact YAML it will apply, and accepts a pasted file. Five steps: organisation, branding, service lines, team and modules, review.

**Command line.** From `web/`:

```bash
pnpm setup:apply                       # reads ../open-ronin.config.yaml
pnpm setup:apply path/to/config.yaml   # or a specific file
pnpm setup:apply --invite              # email the first admin an invite instead of printing a sign-in link
```

It applies the config through the same database function as the wizard (`public.apply_org_config`) and creates `team.first_admin` as an admin.

What setup writes:

| Config | Lands in |
|---|---|
| `org.*` | `org_settings` (name, domain, sign-in domains, time zone, currency) |
| `org.allowed_email_domains` | the sign-up gate (`public.enforce_email_domain`) |
| `brand.primary_color`, `brand.logo` | Admin › Design System overrides (`design_settings`) |
| `service_lines` | `service_lines` + The Work disciplines (`work_disciplines`) |
| `team.departments` | department tags (Admin › Departments) |
| `team.first_admin` | `org_settings.owner_email`; that account gets the admin role |
| `modules` | `app_modules.enabled` (menus and module gates for everyone) |
| `packages`, `auth`, `email`, `ai` | `org_settings` (read by Admin screens and the AI spend checks) |

Roles: the app has four built-in roles. Config role names map as `admin` → admin, `executive` → exec, `manager` → manager, `member` and `contractor` → contributor.

## 6. Deploy

Vercel: import the repo, set the root directory to `web/`, copy the variables from `web/.env.local` (production values), and add your domain. `web/vercel.json` declares the cron jobs; they call `/api/cron/*` with `CRON_SECRET`. In Supabase Auth, set the Site URL to your domain and add `<domain>/auth/callback` to the redirect list.

## Known gaps

- The Proof Library service picker and a few report pages still use the built-in service keys (`pr`, `social`, `podcast`, `flywheel`, `beacon`) next to your configured lines.
- Some modules (Flywheel delivery, Prospects GHL sync, Hiring) ship with empty templates: add your own products, offer templates and pipelines in Admin before using them.
- Airtable-backed pages need the optional Airtable variables; without them they show a not-configured state.
