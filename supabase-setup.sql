-- =====================================================================
-- SPARSH CLIENT PORTAL — Supabase setup
-- Run this whole file once in: Supabase Dashboard > SQL Editor > New query
-- =====================================================================

-- 1) Password hashing support
create extension if not exists pgcrypto with schema extensions;

-- 2) One row per client site
create table if not exists public.sites (
  id            uuid primary key default gen_random_uuid(),
  site_name     text not null,
  password_hash text not null,          -- bcrypt hash, never the plain password
  sheet_url     text not null,          -- Google Sheet "Publish to web" CSV link
  is_active     boolean not null default true,
  created_at    timestamptz not null default now()
);

-- Site names are unique, ignoring upper/lower case
create unique index if not exists sites_site_name_key
  on public.sites (lower(site_name));

-- 3) Failed/successful login log, used to slow down password guessing
create table if not exists public.login_attempts (
  id           bigint generated always as identity primary key,
  site_key     text not null,
  succeeded    boolean not null,
  attempted_at timestamptz not null default now()
);

create index if not exists login_attempts_lookup
  on public.login_attempts (site_key, attempted_at desc);

-- 4) Lock both tables: the public (anon) key can NOT read or write them.
--    RLS is on and no policies exist, so the only way in is the function below.
alter table public.sites          enable row level security;
alter table public.login_attempts enable row level security;
revoke all on public.sites          from anon, authenticated;
revoke all on public.login_attempts from anon, authenticated;

-- 5) Login function. Returns the sheet URL only when site name + password match.
create or replace function public.portal_login(p_site_name text, p_password text)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_key   text := lower(trim(coalesce(p_site_name, '')));
  v_site  public.sites;
  v_fails int;
begin
  -- Basic input sanity
  if v_key = '' or length(v_key) > 120
     or p_password is null or p_password = '' or length(p_password) > 200 then
    return jsonb_build_object('ok', false, 'reason', 'invalid');
  end if;

  -- Tidy old log rows
  delete from login_attempts where attempted_at < now() - interval '1 day';

  -- Too many wrong passwords for this site in the last 15 minutes?
  select count(*) into v_fails
  from login_attempts
  where site_key = v_key
    and succeeded = false
    and attempted_at > now() - interval '15 minutes';

  if v_fails >= 5 then
    return jsonb_build_object('ok', false, 'reason', 'locked');
  end if;

  select * into v_site
  from sites
  where lower(site_name) = v_key
    and is_active
    and password_hash = crypt(p_password, password_hash);

  if found then
    insert into login_attempts (site_key, succeeded) values (v_key, true);
    return jsonb_build_object(
      'ok', true,
      'site_name', v_site.site_name,
      'sheet_url', v_site.sheet_url
    );
  end if;

  insert into login_attempts (site_key, succeeded) values (v_key, false);
  return jsonb_build_object('ok', false, 'reason', 'invalid');
end;
$$;

revoke all on function public.portal_login(text, text) from public;
grant execute on function public.portal_login(text, text) to anon, authenticated;


-- =====================================================================
-- DAY-TO-DAY: manage clients (run these in the SQL Editor)
-- =====================================================================

-- Add a client site
-- insert into public.sites (site_name, password_hash, sheet_url)
-- values (
--   'Shah Residence Bibwewadi',
--   extensions.crypt('ChangeThisPassword#1', extensions.gen_salt('bf')),
--   'https://docs.google.com/spreadsheets/d/e/PASTE-YOUR-ID/pub?output=csv'
-- );

-- Change a client's password
-- update public.sites
-- set password_hash = extensions.crypt('NewPassword#2', extensions.gen_salt('bf'))
-- where lower(site_name) = lower('Shah Residence Bibwewadi');

-- Change which sheet a client sees
-- update public.sites set sheet_url = 'https://docs.google.com/...output=csv'
-- where lower(site_name) = lower('Shah Residence Bibwewadi');

-- Switch a client off / on
-- update public.sites set is_active = false where lower(site_name) = lower('Shah Residence Bibwewadi');

-- Unlock a site after too many wrong passwords
-- delete from public.login_attempts where site_key = lower('Shah Residence Bibwewadi');
