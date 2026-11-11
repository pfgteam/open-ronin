# Install Open Ronin with your AI agent

Open Ronin installs itself through your AI coding agent (Claude Code, Codex, Cursor, OpenCode, or similar). Paste each prompt below into the agent, in order. Each step reads `open-ronin.config.yaml`, does the work, checks it, and tells you when to paste the next one. You don't need to edit code by hand.

> **By hand instead?** [docs/SETUP.md](docs/SETUP.md) has every step as plain commands.

**Before you start:** have a terminal open with your agent, a GitHub account, and about an hour.

---

### Step 0: Questionnaire
```text
Clone https://github.com/pfgteam/open-ronin (or use the current folder if it's already cloned).
Read install/questionnaire.md and follow it exactly. Interview me one question at a time,
then write open-ronin.config.yaml in the repo root using install/open-ronin.config.example.yaml
as the format. Never ask me for passwords or API keys during the interview.
```

### Step 1: Check your machine
```text
Read open-ronin.config.yaml. Check that this machine has what Open Ronin needs: Git, Node.js 20+,
pnpm (enable it with corepack if missing), and the Supabase CLI. If hosting.target is
local or docker-supabase, also check for Docker (the local database runs in it). Install anything missing, asking me before each install.
Report a table: tool, required version, found version, status.
```

### Step 2: Accounts
```text
Read open-ronin.config.yaml (hosting, auth, email, ai). List the accounts I need for this setup
(e.g. Supabase, Vercel, Google Cloud for Google sign-in, Resend, and AI providers) and which ones
I said I already have. Walk me through creating the missing ones, one at a time, with the exact
pages to visit. Don't create anything on my behalf. Tell me which keys I'll need from each account
in Step 4, but don't ask me to paste them yet.
```

### Step 3: Database
```text
Read open-ronin.config.yaml. Create (or link) a Supabase project in hosting.region using the
Supabase CLI, after I log in myself (`supabase login`, `supabase link --project-ref <ref>`).
Apply every migration in supabase/migrations in order (`supabase db push`). If install.demo_data
is true, load the demo seed (`supabase db push --include-seed`, file supabase/seed.sql). For
hosting.target local, `supabase start` from the repo root does both. Then verify: list the tables, confirm
row-level security is on for every public table, and report the migration count applied.
Stop and show me any error. Don't skip or edit migrations.
```

### Step 4: Environment and secrets
```text
Create web/.env.local from web/.env.example. Fill in every non-secret value from
open-ronin.config.yaml and the Supabase project (URL, app URL, allowed email domains).
For each secret (service role key, OAuth secrets, email and AI keys), tell me exactly where to
copy it from and let me paste it into the file myself, or read it from my secret manager if
I have one. Never print a secret back. Generate random values for internal secrets like
CRON_SECRET. Leave variables for integrations I didn't choose blank. Finish with a table of
required variables: set / missing.
```

### Step 5: Run it locally
```text
Install dependencies in web/ with pnpm, run typecheck, lint, tests and a production build, and
fix nothing in the app code. Report any failure to me. Then start the dev server and give me
the local URL.
```

### Step 6: First-run setup
```text
Read open-ronin.config.yaml. Apply it to the running app: organization name and domain, branding,
service lines and their deliverables, packages, departments, roles, enabled modules, client
portal, sign-in methods, and AI spend limits. Use the app's setup wizard (/setup, which loads
open-ronin.config.yaml from the repo root) or its own script (`pnpm setup:apply` in web/), not raw
database edits. Google sign-in also needs the Google provider turned on in Supabase Auth. Create the first admin from team.first_admin. Then sign me
in and show me screenshots of the Work, Clients and Admin pages, with every menu matching the
modules I chose.
```

### Step 7: Bring your data
```text
Read migration in open-ronin.config.yaml. For each source and item in import_first, show me how
to export it (file type, columns), then map it to Open Ronin's import format and show me the
mapping before importing. Do a dry run first, then import, then report rows imported, skipped
and why. Never overwrite existing records.
```

### Step 8: Go live
```text
Read hosting in open-ronin.config.yaml. Deploy: for vercel-supabase, create the Vercel project
from this repo (web/ as the root), copy the env variables from web/.env.local (production values),
set the cron jobs and connect hosting.app_url as a custom domain with the exact DNS records I
need to add. For docker-supabase: there is no Dockerfile in this repo yet, so stop and tell me;
run the app with `pnpm build && pnpm start` in web/ behind an HTTPS proxy only if I ask for that.
Then verify the live URL loads, sign-in works and cron routes answer with auth.
Report the URL and anything left for me to do.
```

### Step 9: Invite your team and turn things on
```text
Read team and integrations in open-ronin.config.yaml. Help me invite users with the right roles,
in small batches, starting with managers. Connect each chosen integration one at a time and test
it. Confirm the AI spend limits are active. Then give me a one-page "how we use Open Ronin" note
for my team, based on the modules I enabled.
```

### Step 10: Go-live checks
```text
Run a go-live check on my Open Ronin install and report pass/fail for each item:
backups enabled in Supabase; RLS on for every table; no secrets committed to git;
service role key only on the server; allowed email domains correct; at least two admins;
error monitoring/logs reachable; spend limits set; demo data removed if I imported real data.
Fix only what I approve.
```

### Staying up to date
```text
Pull the latest Open Ronin from upstream into my install. Show me the changes and any new
migrations first. After I approve, apply the migrations, run typecheck, lint, tests and build,
then deploy. Re-run the Step 10 checks afterwards.
```

---

## Checklist

- [ ] 0. Questionnaire answered, `open-ronin.config.yaml` saved
- [ ] 1. Machine ready (Git, Node 20+, pnpm, Supabase CLI)
- [ ] 2. Accounts created
- [ ] 3. Database created, migrations applied
- [ ] 4. `.env.local` filled in, no missing required variables
- [ ] 5. Builds and runs locally
- [ ] 6. Org, branding, service lines, roles and modules set
- [ ] 7. Data imported
- [ ] 8. Live on your URL
- [ ] 9. Team invited, integrations connected
- [ ] 10. Go-live checks pass

Stuck? Open an issue with the step number and what your agent reported. Remove any secrets first.
