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
hosting.target local, `supabase start` from the repo root does both (if install.demo_data is
false, follow it with `supabase db reset --no-seed`). Then verify: list the tables, confirm
row-level security is on for every public table, and report the migration count applied.
Stop and show me any error. Don't skip or edit migrations.
```

### Step 4: Environment and secrets
```text
Create web/.env.local from web/.env.example. Fill in every non-secret value from
open-ronin.config.yaml and the Supabase project (URL, app URL, allowed email domains).
For a local database, `supabase status` prints the keys: "Publishable" goes in
NEXT_PUBLIC_SUPABASE_ANON_KEY and "Secret" in SUPABASE_SERVICE_ROLE_KEY.
For each secret (service role key, OAuth secrets, email and AI keys), tell me exactly where to
copy it from and let me paste it into the file myself, or read it from my secret manager if
I have one. Never print a secret back. Generate random values for internal secrets like
CRON_SECRET. Leave variables for integrations I didn't choose blank.

Sign-in. Email + password always works and needs nothing here. The login page shows other
methods only once they are really configured:
- Supabase Auth URLs (hosted project): in the Supabase dashboard, Authentication > URL
  Configuration, set Site URL to http://localhost:3000 for now and add these Redirect URLs:
  http://localhost:3000/** and, if hosting.app_url is set, https://<app_url>/** . Step 8
  switches the Site URL to production.
- Google (optional, only if auth.methods includes google): walk me through creating a Google
  OAuth client (Google Cloud console > APIs & Services > Credentials > Create OAuth client ID,
  type "Web application"). Authorized JavaScript origins: http://localhost:3000 AND
  https://<app_url>. Authorized redirect URI: the Supabase callback,
  https://<project-ref>.supabase.co/auth/v1/callback (local database:
  http://127.0.0.1:54321/auth/v1/callback). Then I paste the client ID and secret into Supabase
  (Authentication > Sign In / Providers > Google, or the [auth.external.google] block in
  supabase/config.toml for a local database). Check that BOTH the localhost and the production
  redirect URLs are in Supabase's Redirect URLs list: a mismatch after deploy is the classic way
  to get locked out. If I skip Google, the button simply doesn't appear.
- Email links (optional, only if email.provider is set): help me add the provider as custom
  SMTP in Supabase (Authentication > Emails > SMTP Settings; for Resend: host smtp.resend.com,
  port 465, user resend, password = my Resend API key), send a test, and only then set
  AUTH_EMAIL_ENABLED=true. That turns on "Email me a sign-in link" and "Forgot password?".
  Without an email provider, also turn OFF "Confirm email" (Authentication > Sign In / Providers
  > Email) so teammates who sign up aren't left waiting for a confirmation email; the allowed
  email domains still decide who can sign up.

Finish with a table of required variables: set / missing, and a line for each sign-in method:
on / off.
```

### Step 5: Run it locally
```text
Install dependencies in web/ with pnpm, run typecheck, lint, tests and a production build, and
fix nothing in the app code. Report any failure to me. Then start the dev server and give me
the local URL.
```

### Step 6: First-run setup and your admin account
```text
Read open-ronin.config.yaml. Apply it and create my admin account by running, in web/:
  pnpm setup:apply
(not raw database edits). It applies the organization name and domain, branding, service lines and
their deliverables, packages, departments, roles, enabled modules, client portal, sign-in
methods and AI spend limits, then creates team.first_admin as an admin with the email already
confirmed and prints a ONE-TIME sign-in link. No email provider and no Google are needed.
Give me that link (it is single use and expires in 1 hour). I open it in my browser, it signs
me in and asks me to choose a password; from then on I sign in with my email and that
password. If the link expired or I closed the tab, run `pnpm signin-link <my email>` for a new
one. (Instead of the script I may use the /setup wizard in the browser: the first account that
signs up becomes admin.)
Then check that I'm signed in as admin and show me screenshots of the Work, Clients and Admin
pages, with every menu matching the modules I chose, and of the login page showing only the
sign-in methods that are configured.
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
from this repo (web/ as the root), copy the env variables from web/.env.local with production
values (NEXT_PUBLIC_APP_URL = https://<app_url>), set the cron jobs and connect hosting.app_url
as a custom domain with the exact DNS records I need to add. For docker-supabase: there is no
Dockerfile in this repo yet, so stop and tell me; run the app with `pnpm build && pnpm start`
in web/ behind an HTTPS proxy only if I ask for that.
If Steps 3-6 used a local database, first point web/.env.local at the hosted Supabase project,
run `supabase db push` and `pnpm setup:apply` against it (that creates my admin there too).
Then make sign-in work on the production domain:
1. Supabase dashboard > Authentication > URL Configuration: set Site URL to https://<app_url>
   and make sure Redirect URLs contains https://<app_url>/** (keep http://localhost:3000/** for
   local development). If Google is on, confirm https://<app_url> is an authorized JavaScript
   origin in the Google OAuth client.
2. My admin account is already email-confirmed (setup:apply pre-confirms it), so Supabase's
   "Confirm email" setting can't block it and no email is needed.
3. Prove it: open https://<app_url>/auth/login and sign in as the admin with email + password
   (or, if I haven't set a password yet, run `pnpm signin-link <admin email> --app-url
   https://<app_url>` and open that link). Show me a screenshot of the signed-in Home page and
   of the login page.
Then verify cron routes answer with auth. Report the URL and anything left for me to do.
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
- [ ] 6. Org, branding, service lines, roles and modules set; admin signed in with a password
- [ ] 7. Data imported
- [ ] 8. Live on your URL, Supabase Site URL + redirect URLs on the production domain, admin signed in on prod
- [ ] 9. Team invited, integrations connected
- [ ] 10. Go-live checks pass

Locked out? In web/, `pnpm signin-link <email>` (add `--app-url https://<app_url>` for production) prints a one-time sign-in link for any existing account, no email needed.

Stuck? Open an issue with the step number and what your agent reported. Remove any secrets first.
