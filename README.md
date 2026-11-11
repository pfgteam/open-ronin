# Open Ronin

Open-source, agent-driven agency operations platform.

Plan and deliver client work, keep clients, contacts and their numbers in one place, run your pipeline, hire and onboard people, and let AI agents help, all with row-level security and role-based menus. Built on Next.js and Supabase.

## Install

Open Ronin installs through your AI coding agent. Start with **[INSTALL.md](INSTALL.md)**: paste the prompts in order. Step 0 is a short questionnaire that writes `open-ronin.config.yaml`, and every later step uses it.

Prefer doing it by hand? [docs/SETUP.md](docs/SETUP.md) has the same steps as plain commands. The short version:

```bash
supabase start                       # local database + demo data (needs Docker)
cp web/.env.example web/.env.local   # fill in from `supabase status -o env`
cd web && pnpm install && pnpm dev   # http://localhost:3000, then sign up and finish /setup
```

The website lives at [pfgteam/OR-site](https://github.com/pfgteam/OR-site) and is served at [openronin.com](https://openronin.com).

## What's inside

| Area | What it does |
|---|---|
| Work | Goals > priorities > projects > tasks, boards, recurring work, a bug tracker |
| Clients | Clients, contacts, deliverables, health scores, tickets, client portal |
| Growth | Prospects, pipelines, scoring, a rep's daily queue |
| Studio | Content generation across AI providers, with spend limits |
| Team | Directory, org chart, check-ins, calibration, hiring and onboarding, wiki |
| Admin | Roles and module access, departments, design system, integrations, setup |
| Agents | An MCP server (`/api/mcp`) with scoped tokens, agent identities and an audit trail |

Everything organisation-specific (name, sign-in domains, branding, service lines, departments, modules) is configuration: set it in the first-run wizard or with `pnpm setup:apply`, change it later in Admin.

## Add-ons

Open-source tools that plug into Open Ronin for other functions (automation, CRM, analytics, social, chat, BI and more): **[ADD-ONS.md](ADD-ONS.md)**.

## Repository layout

| Path | What |
|---|---|
| `web/` | The Next.js app (App Router, TypeScript, Tailwind) |
| `supabase/migrations/` | Database schema, reference data, tenant config |
| `supabase/seed.sql` | Fictional demo data |
| `worker/` | Optional skills worker for long-running agent jobs |
| `install/` | Questionnaire and config format for agent installs |
| `docs/` | Setup and environment reference |

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). UI conventions are in [UI_GUIDELINES.md](UI_GUIDELINES.md).

## License

[Unlicense](UNLICENSE) (public domain).
