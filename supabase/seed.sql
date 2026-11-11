-- Open Ronin demo data (optional). Loaded by `supabase db reset` locally
-- ([db.seed] in supabase/config.toml) and by `supabase db push --include-seed`
-- on a hosted project when install.demo_data is true.
--
-- Everything here is fictional: example.com addresses, made-up companies.
-- It does NOT finish setup: the first sign-in still lands on /setup, where the
-- wizard (or `pnpm setup:apply`) names the organisation and picks modules.
-- Before importing real data, drop these rows (ids 00000000-0000-4000-8000-*)
-- or reset the database without the seed (`supabase db reset --no-seed`).

-- Clients
insert into public.clients_v2 (id, display_name, status) values
  ('00000000-0000-4000-8000-00000000c001', 'Acme Snacks', 'active'),
  ('00000000-0000-4000-8000-00000000c002', 'Northwind Outdoors', 'active'),
  ('00000000-0000-4000-8000-00000000c003', 'Contoso Health', 'onboarding'),
  ('00000000-0000-4000-8000-00000000c004', 'Tailspin Coffee', 'paused')
on conflict (id) do nothing;

-- Contacts (client-side people)
insert into public.contacts (id, display_name, first_name, last_name, email, title, organization, notes_md) values
  ('00000000-0000-4000-8000-0000000c0001', 'Jordan Lee', 'Jordan', 'Lee', 'jordan.lee@example.com', 'Head of Marketing', 'Acme Snacks', 'demo'),
  ('00000000-0000-4000-8000-0000000c0002', 'Priya Shah', 'Priya', 'Shah', 'priya.shah@example.com', 'Founder', 'Northwind Outdoors', 'demo'),
  ('00000000-0000-4000-8000-0000000c0003', 'Sam Okafor', 'Sam', 'Okafor', 'sam.okafor@example.com', 'Comms Director', 'Contoso Health', 'demo'),
  ('00000000-0000-4000-8000-0000000c0004', 'Riley Chen', 'Riley', 'Chen', 'riley.chen@example.com', 'Owner', 'Tailspin Coffee', 'demo')
on conflict (id) do nothing;

-- The Work: Goal > Priority > Project > Task (the enforced hierarchy)
insert into public.projects (id, parent_id, name, kind, status, description_md, position) values
  ('00000000-0000-4000-8000-0000000a0001', null, 'Grow retained revenue 20% this year', 'goal', 'in_progress', 'Demo goal.', 10),
  ('00000000-0000-4000-8000-0000000a0002', '00000000-0000-4000-8000-0000000a0001', 'Launch two new service packages', 'priority', 'in_progress', 'Demo priority.', 10),
  ('00000000-0000-4000-8000-0000000a0003', '00000000-0000-4000-8000-0000000a0002', 'Package pricing and one-pagers', 'project', 'in_progress', 'Demo project.', 10),
  ('00000000-0000-4000-8000-0000000a0004', '00000000-0000-4000-8000-0000000a0003', 'Draft the Starter package one-pager', 'task', 'to_do', null, 10),
  ('00000000-0000-4000-8000-0000000a0005', '00000000-0000-4000-8000-0000000a0003', 'Review pricing with finance', 'task', 'to_do', null, 20),
  ('00000000-0000-4000-8000-0000000a0006', '00000000-0000-4000-8000-0000000a0003', 'Publish the packages page', 'task', 'to_do', null, 30)
on conflict (id) do nothing;

-- Client work linked to a demo client
insert into public.projects (id, parent_id, name, kind, status, client_id, description_md, position) values
  ('00000000-0000-4000-8000-0000000b0001', null, 'Acme Snacks: spring launch campaign', 'client_work', 'in_progress', '00000000-0000-4000-8000-00000000c001', 'Demo client work.', 10),
  ('00000000-0000-4000-8000-0000000b0002', null, 'Northwind Outdoors: monthly report', 'client_work', 'to_do', '00000000-0000-4000-8000-00000000c002', 'Demo client work.', 20)
on conflict (id) do nothing;
