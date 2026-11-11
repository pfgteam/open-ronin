# Open Ronin install questionnaire (for the AI agent)

You are installing Open Ronin for a user. Interview them, then write their answers to `open-ronin.config.yaml` in the repo root. Every later install step reads that file.

## How to run the interview
- Ask **one question at a time** and wait for the answer. Don't dump the whole list.
- Offer the listed choices, and accept "other" with a short description.
- Explain in plain words when the user seems unsure. Pick a sensible default if they say "you pick", and tell them what you picked.
- **Never ask for or write passwords, API keys or tokens into the config.** Secrets go in `.env.local` later, typed by the user or pulled from their secret manager.
- Skip questions whose answer is already clear from earlier answers.
- At the end, show the full config, ask "anything to change?", then save it.
- If `open-ronin.config.yaml` already exists, ask whether to update it or start over.

## Questions (config key in brackets)

### 1. Your organization
1. What's the organization called? `[org.name]`
2. Your website domain, e.g. `example.com`. `[org.domain]`
3. Which email domains can sign in? Default: the org domain. `[org.allowed_email_domains]`
4. Time zone and default currency. `[org.timezone]` `[org.currency]`
5. Do you have a logo file and brand colors? Get the paths/hex values, or say "set later in Admin". `[brand.logo]` `[brand.primary_color]`

### 2. What you do
6. What kind of organization is this? Choices: agency, consultancy, in-house team, studio, other. `[org.type]`
7. Which service lines do you deliver to clients? Pick any: PR, social media, content/writing, SEO/GEO, design/branding, paid ads, events, other. Each one becomes a configurable work type. `[service_lines]`
8. For each service line: what are the deliverables called, and do clients get reports? `[service_lines[].deliverables]` `[service_lines[].reports]`
9. Do you sell packages or tiers? If so, list them. `[packages]`

### 3. Your team
10. How many people will use it, now and in a year? `[team.size_now]` `[team.size_12mo]`
11. What departments or teams do you have? `[team.departments]`
12. Which roles do you need? Default: admin, executive, manager, member, contractor. `[team.roles]`
13. Who is the first admin (name and email)? `[team.first_admin]`

### 4. Modules to turn on
14. Which modules? Pick any:
    - Work (goals, projects, tasks, boards)
    - Clients (clients, contacts, tickets, portals)
    - Growth (prospects, pipeline)
    - Studio (content and pitching)
    - Team (directory, performance, hiring, knowledge)
    - Management (dashboards, requests desk)
    - AI agents/bots

    Default: Work, Clients and Team. `[modules]`
15. Will clients log in to a client portal? `[modules.client_portal]`

### 5. Data you're bringing
16. What do you use today? Pick any: spreadsheets, Airtable, Asana, Monday, ClickUp, Notion, a CRM (which one), nothing. `[migration.sources]`
17. What should come over first: clients, contacts, projects/tasks, team members, or nothing (start clean)? `[migration.import_first]`
18. Load demo data so you can explore first? `[install.demo_data]`

### 6. Hosting
19. Where should it run? Choices:
    - Vercel + Supabase cloud (recommended, easiest)
    - Your own server with Docker + Supabase
    - Local only, just trying it

    `[hosting.target]`
20. Do you already have Supabase / Vercel / GitHub accounts? `[hosting.accounts]`
21. App URL, e.g. `app.example.com`, or "use the default host URL for now". `[hosting.app_url]`
22. Which Supabase region is closest to your team? `[hosting.region]`

### 7. Sign-in, email and integrations
23. Besides email + password (always on), which sign-in methods: Google, email magic link, both, or neither for now? Each one is optional and only appears once it's configured in Step 4. `[auth.methods]`
24. Who sends transactional email? Choices: Resend (default), other SMTP, or none yet. `[email.provider]` `[email.from]`
25. Which integrations, if any? Pick any: Google Workspace, Slack, a CRM, social schedulers, transcription, others. Integrations can be added later. `[integrations]`

### 8. AI
26. Use AI features? Which providers do you have keys for? Choices: Anthropic, OpenAI, Google, xAI, other, or none. `[ai.providers]`
27. Monthly AI spend cap: total and per person. `[ai.spend_limit_total]` `[ai.spend_limit_per_user]`

### 9. You and the timeline
28. How technical is the person running the install? Choices: "just do it for me", "I can follow along", "I'm a developer". This sets how much the agent explains. `[install.comfort]`
29. When do you want to be live? `[install.target_date]`

## Output format
Write `open-ronin.config.yaml` following `install/open-ronin.config.example.yaml`. Unknown answers become `null` with a `# TODO` comment. Then tell the user:

> Saved. Next, paste the Step 1 prompt from INSTALL.md.
