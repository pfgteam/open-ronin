-- Open Ronin tenant configuration.
--
-- Everything that used to be hardcoded for one organisation lives here:
-- name, domain, sign-in domains, owner, branding pointers, modules, service
-- lines, packages, AI limits. The first-run setup wizard (/setup) and
-- `pnpm setup:apply` (web/scripts/apply-config.mjs) both write these rows
-- from open-ronin.config.yaml; Admin screens edit them afterwards.

-- ---------------------------------------------------------------------------
-- org_settings: one row per tenant
-- ---------------------------------------------------------------------------
create table if not exists public.org_settings (
  tenant_id uuid primary key default spine.default_tenant_id() references spine.tenants(id) on delete cascade,
  org_name text not null default 'Open Ronin',
  org_domain text,
  org_type text,
  allowed_email_domains text[] not null default '{}',
  timezone text not null default 'UTC',
  currency text not null default 'USD',
  owner_email text,
  owner_name text,
  support_email text,
  app_url text,
  modules jsonb not null default '{}'::jsonb,
  client_portal boolean not null default false,
  auth_methods text[] not null default '{magic_link}',
  email_provider text,
  email_from text,
  ai_providers text[] not null default '{}',
  ai_spend_limit_total numeric,
  ai_spend_limit_per_user numeric,
  packages jsonb not null default '[]'::jsonb,
  team jsonb not null default '{}'::jsonb,
  config jsonb,
  setup_completed_at timestamptz,
  updated_by uuid references public.profiles(id) on delete set null,
  updated_at timestamptz not null default now(),
  constraint org_settings_name_len check (char_length(org_name) between 1 and 120),
  constraint org_settings_currency check (currency ~ '^[A-Z]{3}$')
);

insert into public.org_settings (tenant_id) values (spine.default_tenant_id()) on conflict do nothing;

alter table public.org_settings enable row level security;
drop policy if exists org_settings_select on public.org_settings;
create policy org_settings_select on public.org_settings for select to authenticated using (true);
drop policy if exists org_settings_update on public.org_settings;
create policy org_settings_update on public.org_settings for update to authenticated
  using ((select public.is_admin())) with check ((select public.is_admin()));
revoke all on public.org_settings from anon, public;
grant select, update on public.org_settings to authenticated;
grant all on public.org_settings to service_role;

-- ---------------------------------------------------------------------------
-- service_lines: configurable work types (PR, Social, SEO, ...)
-- ---------------------------------------------------------------------------
create table if not exists public.service_lines (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default spine.default_tenant_id() references spine.tenants(id) on delete cascade,
  key text not null,
  label text not null,
  deliverables text[] not null default '{}',
  reports boolean not null default false,
  sort integer not null default 100,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint service_lines_key_check check (key ~ '^[a-z][a-z0-9_]{0,30}$'),
  constraint service_lines_label_len check (char_length(label) between 1 and 60),
  unique (tenant_id, key)
);
alter table public.service_lines enable row level security;
drop policy if exists service_lines_select on public.service_lines;
create policy service_lines_select on public.service_lines for select to authenticated using (true);
drop policy if exists service_lines_write on public.service_lines;
create policy service_lines_write on public.service_lines for all to authenticated
  using ((select public.is_admin())) with check ((select public.is_admin()));
revoke all on public.service_lines from anon, public;
grant select, insert, update, delete on public.service_lines to authenticated;
grant all on public.service_lines to service_role;

-- modules can be switched off for the whole org (menus + RLS gates)
alter table public.app_modules add column if not exists enabled boolean not null default true;

-- ---------------------------------------------------------------------------
-- helpers used by the baseline functions
-- ---------------------------------------------------------------------------
create or replace function public.org_email_domains()
returns text[] language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce((select array(select lower(d) from unnest(allowed_email_domains) d)
                   from public.org_settings where tenant_id = spine.default_tenant_id()), '{}'::text[])
$$;

create or replace function public.is_org_email(p_email text)
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce(lower(split_part(p_email, '@', 2)) = any (public.org_email_domains()), false)
$$;

create or replace function public.org_owner_email()
returns text language sql stable security definer set search_path = public, pg_temp as $$
  select lower(owner_email) from public.org_settings where tenant_id = spine.default_tenant_id()
$$;

-- Public (pre-login) identity: name, domain hint, sign-in methods. No secrets.
create or replace function public.org_public_info()
returns jsonb language sql stable security definer set search_path = public, pg_temp as $$
  select jsonb_build_object(
    'org_name', o.org_name,
    'allowed_email_domains', o.allowed_email_domains,
    'auth_methods', o.auth_methods,
    'support_email', o.support_email,
    'setup_completed', o.setup_completed_at is not null)
  from public.org_settings o where o.tenant_id = spine.default_tenant_id()
$$;

-- Is setup still open, and is there an admin yet?
create or replace function public.setup_state()
returns jsonb language sql stable security definer set search_path = public, pg_temp as $$
  select jsonb_build_object(
    'setup_completed', (select setup_completed_at is not null from public.org_settings where tenant_id = spine.default_tenant_id()),
    'has_admin', exists (select 1 from public.profiles where role in ('admin', 'exec') and is_active))
$$;

-- Bootstrap: the first signed-in user claims admin, but only while setup is
-- open and nobody is admin yet. After that the normal role screens apply.
create or replace function public.setup_claim_admin()
returns boolean language plpgsql security definer set search_path = public, pg_temp as $$
declare v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'sign in first' using errcode = 'insufficient_privilege';
  end if;
  if exists (select 1 from public.org_settings where tenant_id = spine.default_tenant_id() and setup_completed_at is not null) then
    return false;
  end if;
  if exists (select 1 from public.profiles where role in ('admin', 'exec') and is_active) then
    return false;
  end if;
  perform set_config('app.setup_claim', 'on', true);
  update public.profiles set role = 'admin' where id = v_uid;
  return found;
end $$;

-- role guard: same rule as before, plus the one-time bootstrap claim above
-- (only while no admin exists, only inside setup_claim_admin()).
create or replace function public.protect_profile_privileges()
returns trigger language plpgsql set search_path = public as $$
begin
  if (new.role is distinct from old.role)
     or (new.is_active is distinct from old.is_active)
     or (new.calibration_excluded is distinct from old.calibration_excluded) then
    if auth.uid() is null then
      return new;
    end if;
    if current_setting('app.setup_claim', true) = 'on'
       and new.id = auth.uid()
       and not exists (select 1 from public.profiles where role in ('admin', 'exec') and is_active) then
      return new;
    end if;
    if not public.is_admin() then
      raise exception 'Only admins can change role, active status or calibration exclusion'
        using errcode = '42501';
    end if;
  end if;
  return new;
end $$;

revoke all on function public.org_email_domains() from public, anon;
revoke all on function public.is_org_email(text) from public, anon;
revoke all on function public.org_owner_email() from public, anon;
revoke all on function public.setup_claim_admin() from public, anon;
grant execute on function public.org_email_domains() to authenticated, service_role;
grant execute on function public.is_org_email(text) to authenticated, service_role;
grant execute on function public.org_owner_email() to authenticated, service_role;
grant execute on function public.org_public_info() to anon, authenticated, service_role;
grant execute on function public.setup_state() to anon, authenticated, service_role;
grant execute on function public.setup_claim_admin() to authenticated;

-- ---------------------------------------------------------------------------
-- sign-in gate: org domains from org_settings. Empty list = open (first run,
-- before the wizard sets domains), so the first admin can sign up.
-- ---------------------------------------------------------------------------
create or replace function public.enforce_email_domain()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare
  user_domain text;
  allowed text[] := public.org_email_domains();
begin
  if coalesce(new.raw_app_meta_data->>'portal', '') = 'true' then
    return new;   -- client portal login: any domain, no profile, restricted by is_portal_user()
  end if;
  if cardinality(allowed) = 0 then
    return new;   -- setup not finished: no domain list yet
  end if;
  user_domain := lower(split_part(new.email, '@', 2));
  if lower(new.email) = public.org_owner_email() then
    return new;
  end if;
  if not (user_domain = any(allowed)) then
    raise exception 'Email domain % is not allowed. Allowed: %', user_domain, array_to_string(allowed, ', ');
  end if;
  return new;
end $$;

-- new profiles: the configured owner (team.first_admin) starts as admin
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare
  meta jsonb := new.raw_user_meta_data;
  fn text;
  ln text;
  full_n text;
  space_pos int;
  v_role text := 'contributor';
begin
  if coalesce(new.raw_app_meta_data->>'portal', '') = 'true' then
    return new;
  end if;
  fn := coalesce(nullif(meta->>'first_name', ''), nullif(meta->>'given_name', ''));
  ln := coalesce(nullif(meta->>'last_name', ''), nullif(meta->>'family_name', ''));
  if fn is null or ln is null then
    full_n := coalesce(meta->>'name', meta->>'full_name', '');
    space_pos := position(' ' in full_n);
    if space_pos > 0 then
      fn := coalesce(fn, substring(full_n from 1 for space_pos - 1));
      ln := coalesce(ln, substring(full_n from space_pos + 1));
    elsif full_n <> '' then
      fn := coalesce(fn, full_n);
    end if;
  end if;
  if fn is null or fn = '' then
    fn := split_part(new.email, '@', 1);
  end if;
  if public.org_owner_email() is not null and lower(new.email) = public.org_owner_email() then
    v_role := 'admin';
  end if;
  insert into public.profiles (id, email, first_name, last_name, role)
  values (new.id, new.email, fn, coalesce(ln, ''), v_role)
  on conflict (id) do nothing;
  return new;
end $$;

-- module switches apply to everyone (the admin floor still keeps admin itself)
create or replace function public.has_module_access(p_module text)
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce((select enabled from public.app_modules where key = p_module), true)
     and exists (
    select 1 from public.profiles p
    where p.id = auth.uid()
      and p.is_active
      and (
        p.role in ('admin', 'exec')
        or exists (
          select 1 from public.role_permissions rp
          where rp.role = p.role and rp.module_key = p_module and rp.allowed
        )
      )
  )
$$;

-- service-line vocabulary checks accept the configured lines (plus the
-- built-in keys the Proof Library picker still offers; see docs/SETUP.md)
create or replace function public.proof_services_ok(p text[])
returns boolean language sql stable set search_path = public, pg_temp as $$
  select p is null or p <@ (array['pr','social','podcast','flywheel','beacon']::text[]
    || coalesce((select array_agg(key) from public.service_lines where is_active), '{}'::text[]))
$$;

-- ---------------------------------------------------------------------------
-- apply_org_config(): the one write path for the wizard and setup:apply.
-- Takes the parsed open-ronin.config.yaml as jsonb. Admin (or service role)
-- only. Idempotent: re-applying the same file changes nothing.
-- ---------------------------------------------------------------------------
create or replace function public.apply_org_config(p_config jsonb, p_complete boolean default true)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_tenant uuid := spine.default_tenant_id();
  v_org jsonb := coalesce(p_config->'org', '{}'::jsonb);
  v_brand jsonb := coalesce(p_config->'brand', '{}'::jsonb);
  v_mod jsonb := coalesce(p_config->'modules', '{}'::jsonb);
  v_team jsonb := coalesce(p_config->'team', '{}'::jsonb);
  v_ai jsonb := coalesce(p_config->'ai', '{}'::jsonb);
  v_line jsonb;
  v_dep text;
  v_i int := 0;
  v_keys text[] := '{}';
  v_lines int := 0;
  v_deps int := 0;
  v_role text := current_setting('request.jwt.claims', true)::jsonb->>'role';
  v_map jsonb := '{"work":["the_work"],"clients":["clients","media"],"growth":["prospects"],"studio":["social"],"team":["team","hiring"],"management":["dashboard"]}'::jsonb;
  v_k text;
  v_mk text;
  v_logo text;
  v_org_tag uuid;
begin
  if coalesce(v_role, '') <> 'service_role' and not public.is_admin() then
    raise exception 'only an admin can apply the organisation config' using errcode = 'insufficient_privilege';
  end if;

  update public.org_settings set
    org_name = coalesce(nullif(v_org->>'name', ''), org_name),
    org_domain = nullif(v_org->>'domain', ''),
    org_type = nullif(v_org->>'type', ''),
    allowed_email_domains = coalesce((select array_agg(lower(x)) from jsonb_array_elements_text(v_org->'allowed_email_domains') x), allowed_email_domains),
    timezone = coalesce(nullif(v_org->>'timezone', ''), timezone),
    currency = upper(coalesce(nullif(v_org->>'currency', ''), currency)),
    owner_email = coalesce(lower(nullif(v_team->'first_admin'->>'email', '')), owner_email),
    owner_name = coalesce(nullif(v_team->'first_admin'->>'name', ''), owner_name),
    app_url = coalesce(nullif(p_config->'hosting'->>'app_url', ''), app_url),
    modules = v_mod,
    client_portal = coalesce((v_mod->>'client_portal')::boolean, false),
    auth_methods = coalesce((select array_agg(x) from jsonb_array_elements_text(p_config->'auth'->'methods') x), auth_methods),
    email_provider = nullif(p_config->'email'->>'provider', ''),
    email_from = nullif(p_config->'email'->>'from', ''),
    ai_providers = coalesce((select array_agg(x) from jsonb_array_elements_text(v_ai->'providers') x), '{}'),
    ai_spend_limit_total = nullif(v_ai->>'spend_limit_total', '')::numeric,
    ai_spend_limit_per_user = nullif(v_ai->>'spend_limit_per_user', '')::numeric,
    packages = coalesce(p_config->'packages', '[]'::jsonb),
    team = jsonb_strip_nulls(jsonb_build_object('size_now', v_team->'size_now', 'size_12mo', v_team->'size_12mo', 'roles', v_team->'roles')),
    config = p_config,
    setup_completed_at = case when p_complete then coalesce(setup_completed_at, now()) else setup_completed_at end,
    updated_by = auth.uid(),
    updated_at = now()
  where tenant_id = v_tenant;

  -- branding -> Admin > Design System overrides (design_settings.settings)
  if v_brand ? 'primary_color' or v_brand ? 'logo' or v_org ? 'name' then
    insert into public.design_settings (tenant_id, settings) values (v_tenant, '{}'::jsonb)
      on conflict (tenant_id) do nothing;
    -- keys follow lib/design/settings.ts (identity.org_name / logo_*_url, brand.primary);
    -- a logo is only taken when it is an https:// URL or a /path the app serves
    v_logo := case when coalesce(v_brand->>'logo', '') ~ '^(https://|/)[^\s"''<>]+$' then v_brand->>'logo' end;
    update public.design_settings set
      settings = coalesce(settings, '{}'::jsonb)
        || jsonb_build_object('identity', coalesce(settings->'identity', '{}'::jsonb)
             || jsonb_strip_nulls(jsonb_build_object('org_name', left(nullif(v_org->>'name', ''), 80),
                                   'app_name', left(nullif(v_org->>'name', ''), 40),
                                   'logo_light_url', v_logo, 'logo_dark_url', v_logo)))
        || case when coalesce(v_brand->>'primary_color', '') ~ '^#[0-9a-fA-F]{6}$'
                then jsonb_build_object('brand', coalesce(settings->'brand', '{}'::jsonb) || jsonb_build_object('primary', v_brand->>'primary_color'))
                else '{}'::jsonb end,
      updated_at = now()
    where tenant_id = v_tenant;
  end if;

  -- service lines (+ mirror into The Work disciplines)
  if jsonb_typeof(p_config->'service_lines') = 'array' then
    for v_line in select * from jsonb_array_elements(p_config->'service_lines') loop
      v_i := v_i + 1;
      v_keys := v_keys || lower(v_line->>'key');
      insert into public.service_lines (tenant_id, key, label, deliverables, reports, sort, is_active)
      values (v_tenant, lower(v_line->>'key'), coalesce(nullif(v_line->>'label', ''), v_line->>'key'),
              coalesce((select array_agg(x) from jsonb_array_elements_text(v_line->'deliverables') x), '{}'),
              coalesce((v_line->>'reports')::boolean, false), v_i * 10, true)
      on conflict (tenant_id, key) do update set label = excluded.label, deliverables = excluded.deliverables,
        reports = excluded.reports, sort = excluded.sort, is_active = true, updated_at = now();
      insert into public.work_disciplines (slug, label, position)
      values (lower(v_line->>'key'), coalesce(nullif(v_line->>'label', ''), v_line->>'key'), v_i * 10)
      on conflict (slug) do update set label = excluded.label, position = excluded.position, archived_at = null;
      v_lines := v_lines + 1;
    end loop;
    update public.service_lines set is_active = false, updated_at = now()
      where tenant_id = v_tenant and not (key = any (v_keys));
    update public.work_disciplines set archived_at = coalesce(archived_at, now())
      where not (slug = any (v_keys));
  end if;

  -- departments -> department tags under the org tag (tag hierarchy: org > department > sub-team)
  if jsonb_typeof(v_team->'departments') = 'array' then
    insert into public.tags (slug, label, color, category, is_system, position)
    values ('org-main', left(coalesce(nullif(v_org->>'name', ''), 'Main'), 60), '#069494', 'org', true, 0)
    on conflict (slug) do update set label = excluded.label
    returning id into v_org_tag;
    v_i := 0;
    for v_dep in select * from jsonb_array_elements_text(v_team->'departments') loop
      v_i := v_i + 1;
      insert into public.tags (slug, label, color, parent_tag_id, category, is_system, position)
      values (trim(both '-' from regexp_replace(lower(v_dep), '[^a-z0-9]+', '-', 'g')), v_dep, '#64748b', v_org_tag, 'department', true, v_i * 10)
      on conflict (slug) do update set label = excluded.label, position = excluded.position
        where public.tags.category = 'department';
      v_deps := v_deps + 1;
    end loop;
  end if;

  -- modules: config key -> app module keys; admin and data always stay on
  for v_k in select jsonb_object_keys(v_map) loop
    for v_mk in select jsonb_array_elements_text(v_map->v_k) loop
      update public.app_modules set enabled = coalesce((v_mod->>v_k)::boolean, true) where key = v_mk;
    end loop;
  end loop;
  update public.app_modules set enabled = (v_lines = 0 or 'flywheel' = any (v_keys)) where key = 'flywheel';
  update public.app_modules set enabled = true where key in ('admin', 'data');

  -- AI: the org-wide monthly cap becomes a team-scope limit (per-person caps
  -- need a user, so they stay on org_settings until people are invited)
  if coalesce(nullif(v_ai->>'spend_limit_total', '')::numeric, 0) > 0 then
    update public.ai_spend_limits set cap_usd = (v_ai->>'spend_limit_total')::numeric, is_active = true, updated_at = now()
      where tenant_id = v_tenant and scope = 'team' and period = 'month' and note = 'open-ronin.config.yaml';
    if not found then
      insert into public.ai_spend_limits (tenant_id, scope, period, cap_usd, note)
      values (v_tenant, 'team', 'month', (v_ai->>'spend_limit_total')::numeric, 'open-ronin.config.yaml');
    end if;
  end if;

  return jsonb_build_object('ok', true, 'service_lines', v_lines, 'departments', v_deps,
    'modules', (select jsonb_object_agg(key, enabled) from public.app_modules));
end $$;
revoke all on function public.apply_org_config(jsonb, boolean) from public, anon;
grant execute on function public.apply_org_config(jsonb, boolean) to authenticated, service_role;
