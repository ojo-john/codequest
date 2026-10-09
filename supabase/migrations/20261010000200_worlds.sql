-- Worlds (spec §2) and per-skill practice summaries for the skill tree (spec §39).

create table public.worlds (
  id text primary key check (id ~ '^[a-z0-9]+(\.[a-z0-9-]+)*$'),
  number smallint not null unique check (number between 0 and 20),
  name text not null check (char_length(name) between 1 and 60),
  summary text not null,
  -- False for worlds whose content isn't built yet; shown as "coming later", never hidden.
  available boolean not null default false
);

alter table public.skills add column world_id text references public.worlds (id);

alter table public.worlds enable row level security;
create policy "worlds: readable" on public.worlds for select to anon, authenticated using (true);
revoke all on public.worlds from anon, authenticated;
grant select on public.worlds to anon, authenticated;

-- How much evidence each of the learner's skill dimensions has, and when it was last practised.
create function public.skill_practice(p_user_id uuid)
returns table (skill_id text, dimension public.skill_dimension, evidence_count bigint, last_practiced_at timestamptz)
language sql
stable
security definer
set search_path = ''
as $$
  select e.skill_id, e.dimension, count(*), max(e.created_at)
  from public.mastery_evidence e
  where e.user_id = p_user_id
  group by e.skill_id, e.dimension;
$$;

revoke all on function public.skill_practice(uuid) from public, anon, authenticated;
grant execute on function public.skill_practice(uuid) to service_role;
