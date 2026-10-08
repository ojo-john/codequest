-- CodeQuest schema, part 1: profiles and curriculum content (spec §42, §44–45, §66).
--
-- Access model (enforced with RLS on every table plus explicit grants):
--   * User-owned rows: only the authenticated owner; identity always comes from auth.uid(),
--     never from a client-supplied user_id.
--   * Content: readable only once published. Nobody writes content through the API; the
--     content pipeline uses trusted server credentials.
--   * Private judge material lives in the `private` schema, which PostgREST does not expose.

create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

-- ---------------------------------------------------------------------------------------------
-- Shared types
-- ---------------------------------------------------------------------------------------------

create type public.skill_dimension as enum (
  'concept', 'recognition', 'implementation', 'complexity', 'explanation', 'testing', 'communication', 'design'
);

create type public.content_status as enum ('draft', 'ai_reviewed', 'human_reviewed', 'published', 'deprecated');

create type public.content_kind as enum (
  'lesson', 'question', 'problem', 'project', 'recognition_task', 'system_design_scenario', 'cheat_sheet'
);

create type public.prerequisite_kind as enum ('strict', 'recommended');

-- Keeps updated_at honest without trusting clients.
create function public.touch_updated_at() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- ---------------------------------------------------------------------------------------------
-- Profiles
-- ---------------------------------------------------------------------------------------------

create table public.profiles (
  user_id uuid primary key references auth.users (id) on delete cascade,
  -- IANA zone used for streak days and notification quiet hours (spec §37, §49).
  timezone text not null default 'UTC',
  target_role text check (char_length(target_role) <= 100),
  -- Goals and preferences (spec §71); validated by the server's Zod schema.
  settings jsonb not null default '{}'::jsonb check (jsonb_typeof(settings) = 'object'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create function public.validate_profile_timezone() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if not exists (select 1 from pg_catalog.pg_timezone_names where name = new.timezone) then
    raise exception 'unknown IANA timezone: %', new.timezone using errcode = '22023';
  end if;
  return new;
end;
$$;

create trigger profiles_validate_timezone before insert or update of timezone on public.profiles
  for each row execute function public.validate_profile_timezone();
create trigger profiles_touch before update on public.profiles
  for each row execute function public.touch_updated_at();

-- Every new auth user gets a profile; users never insert profiles themselves.
create function private.create_profile_for_new_user() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (user_id) values (new.id) on conflict do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created after insert on auth.users
  for each row execute function private.create_profile_for_new_user();

alter table public.profiles enable row level security;

create policy "profiles: owner reads" on public.profiles
  for select to authenticated using ((select auth.uid()) = user_id);
create policy "profiles: owner updates" on public.profiles
  for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);

revoke all on public.profiles from anon, authenticated;
grant select on public.profiles to authenticated;
-- Only these columns are user-editable; user_id and timestamps are not.
grant update (timezone, target_role, settings) on public.profiles to authenticated;

-- ---------------------------------------------------------------------------------------------
-- Skills and the prerequisite graph (spec §2, §39)
-- ---------------------------------------------------------------------------------------------

create table public.skills (
  id text primary key check (id ~ '^[a-z0-9]+(\.[a-z0-9-]+)*$'),
  category text not null,
  name text not null,
  definition text not null,
  difficulty smallint not null check (difficulty between 1 and 6),
  created_at timestamptz not null default now()
);

create table public.skill_edges (
  skill_id text not null references public.skills (id) on delete cascade,
  prerequisite_id text not null references public.skills (id) on delete cascade,
  -- Strict prerequisites gate; recommended ones only order the learning path (spec §39).
  edge_kind public.prerequisite_kind not null,
  primary key (skill_id, prerequisite_id),
  check (skill_id <> prerequisite_id)
);

create index skill_edges_prerequisite_idx on public.skill_edges (prerequisite_id);

-- Strict prerequisites must form a DAG (spec §66: detect cycles in strict prerequisite edges).
create function public.reject_strict_prerequisite_cycle() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.edge_kind <> 'strict' then
    return new;
  end if;
  -- Serialise strict-edge changes so two concurrent inserts can't jointly close a cycle.
  perform pg_advisory_xact_lock(hashtext('codequest.skill_edges.strict'));
  if exists (
    with recursive reachable(skill) as (
      select e.prerequisite_id from public.skill_edges e
        where e.skill_id = new.prerequisite_id and e.edge_kind = 'strict'
      union
      select e.prerequisite_id from public.skill_edges e
        join reachable r on e.skill_id = r.skill
        where e.edge_kind = 'strict'
    )
    select 1 from reachable where skill = new.skill_id
  ) then
    raise exception 'strict prerequisite % -> % would create a cycle', new.skill_id, new.prerequisite_id
      using errcode = '23514';
  end if;
  return new;
end;
$$;

create trigger skill_edges_reject_cycle before insert or update on public.skill_edges
  for each row execute function public.reject_strict_prerequisite_cycle();

-- ---------------------------------------------------------------------------------------------
-- Versioned content (spec §44–45). Attempts reference immutable versions.
-- ---------------------------------------------------------------------------------------------

create table public.content_items (
  id text primary key check (id ~ '^[a-z0-9]+(\.[a-z0-9-]+)*$'),
  kind public.content_kind not null,
  created_at timestamptz not null default now()
);

create table public.content_versions (
  id uuid primary key default gen_random_uuid(),
  content_id text not null references public.content_items (id) on delete restrict,
  version integer not null check (version >= 1),
  status public.content_status not null default 'draft',
  -- Public part only: statements, visible tests, lesson text. Never solutions or hidden cases.
  payload jsonb not null check (jsonb_typeof(payload) = 'object'),
  -- Author, sources, license, review notes (spec §23, §45).
  provenance jsonb not null check (provenance ? 'license' and provenance ? 'author'),
  reviewed_at timestamptz,
  published_at timestamptz,
  created_at timestamptz not null default now(),
  unique (content_id, version),
  -- Human review status must be truthful: anything at or past human review needs a review date.
  check (status not in ('human_reviewed', 'published', 'deprecated') or reviewed_at is not null)
);

create index content_versions_published_idx on public.content_versions (content_id) where status = 'published';

-- Published versions are immutable; they may only move to deprecated (spec §45).
create function public.protect_published_content() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    if old.status in ('published', 'deprecated') then
      raise exception 'published content version % cannot be deleted', old.id using errcode = '42501';
    end if;
    return old;
  end if;
  if old.status in ('published', 'deprecated') then
    if new.payload is distinct from old.payload
       or new.content_id is distinct from old.content_id
       or new.version is distinct from old.version
       or new.provenance is distinct from old.provenance
       or not (new.status = old.status or (old.status = 'published' and new.status = 'deprecated')) then
      raise exception 'published content version % is immutable; create a new version', old.id using errcode = '42501';
    end if;
  end if;
  if new.status = 'published' and old.status <> 'published' then
    new.published_at := now();
  end if;
  return new;
end;
$$;

create trigger content_versions_protect before update or delete on public.content_versions
  for each row execute function public.protect_published_content();

create table public.content_skill_tags (
  content_version_id uuid not null references public.content_versions (id) on delete cascade,
  skill_id text not null references public.skills (id) on delete restrict,
  dimension public.skill_dimension not null,
  primary key (content_version_id, skill_id, dimension)
);

create index content_skill_tags_skill_idx on public.content_skill_tags (skill_id);

create table public.rubric_versions (
  id text primary key,
  definition jsonb not null check (jsonb_typeof(definition) = 'object'),
  created_at timestamptz not null default now()
);

-- Server-only judge material: reference solutions, hidden contract expectations.
create table private.content_secrets (
  content_version_id uuid primary key references public.content_versions (id) on delete cascade,
  reference_solution jsonb,
  hidden_grading jsonb not null,
  created_at timestamptz not null default now()
);

alter table public.skills enable row level security;
alter table public.skill_edges enable row level security;
alter table public.content_items enable row level security;
alter table public.content_versions enable row level security;
alter table public.content_skill_tags enable row level security;
alter table public.rubric_versions enable row level security;

create policy "skills: readable" on public.skills for select to anon, authenticated using (true);
create policy "skill_edges: readable" on public.skill_edges for select to anon, authenticated using (true);
create policy "content_items: readable" on public.content_items for select to anon, authenticated using (true);
create policy "content_versions: published readable" on public.content_versions
  for select to anon, authenticated using (status = 'published');
create policy "content_skill_tags: published readable" on public.content_skill_tags
  for select to anon, authenticated using (
    exists (select 1 from public.content_versions v where v.id = content_version_id and v.status = 'published')
  );
create policy "rubric_versions: readable" on public.rubric_versions for select to authenticated using (true);

revoke all on public.skills, public.skill_edges, public.content_items, public.content_versions,
  public.content_skill_tags, public.rubric_versions from anon, authenticated;
grant select on public.skills, public.skill_edges, public.content_items, public.content_versions,
  public.content_skill_tags to anon, authenticated;
grant select on public.rubric_versions to authenticated;
