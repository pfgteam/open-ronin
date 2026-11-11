# Contributing to Open Ronin

Thanks for helping. Open Ronin is public domain ([Unlicense](UNLICENSE)); by sending a change you agree it is released the same way.

## Getting set up

Follow [docs/SETUP.md](docs/SETUP.md) to run the app locally against a local Supabase (`supabase start`). The demo seed gives you something to click on.

## Before you open a pull request

Run the same gates CI runs, from `web/`:

```bash
pnpm typecheck
pnpm lint
pnpm test
pnpm build
cd .. && bash scripts/ui-audit.sh
```

All must pass. Add or update unit tests for logic you change (`*.test.ts` next to the code, Vitest).

## Database changes

- Never edit an existing migration. Add a new one: `supabase migration new <short_name>`, then `pnpm migrations:manifest` in `web/`.
- Make migrations additive and idempotent where you can (`if not exists`, `create or replace`, `on conflict do nothing`).
- Every new table gets row-level security and explicit grants. Check `supabase db reset` applies the whole chain cleanly.

## Code conventions

- UI: use the primitives in `web/src/components/ui` and follow [UI_GUIDELINES.md](UI_GUIDELINES.md).
- Server actions: validate input with zod, rely on RLS as the real guard, return `{ ok, error }`.
- A `'use server'` file may export only async functions (no types or constants); `next build` fails otherwise.
- A `'use client'` component must not import from modules that import `@/lib/supabase/server`.
- Nothing organisation-specific in code: names, domains, emails, brands and service lines come from `org_settings` / `service_lines` (`web/src/lib/tenant`).

## Secrets and data

- Never commit `.env*` files, keys, tokens or real customer data. Test fixtures use `example.com` addresses and made-up names.
- Run a secret scan before pushing, e.g. `gitleaks detect --source . --no-git`.

## Reporting bugs and security issues

Open an issue with steps to reproduce. For security problems, do not open a public issue; contact the maintainers privately through the repository's security advisory form.
