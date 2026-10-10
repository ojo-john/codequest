-- Campaigns (spec §8, §9, §69). A "project" campaign builds one project across its quests (the
-- shopping cart); in a "problems" campaign each quest is a standalone problem with its own
-- project, keyed by the quest's content id.

create table public.campaigns (
  id text primary key check (id ~ '^[a-z0-9]+(\.[a-z0-9-]+)*$'),
  title text not null check (char_length(title) between 3 and 80),
  summary text not null,
  world_id text not null references public.worlds (id),
  kind text not null check (kind in ('project', 'problems'))
);

alter table public.campaigns enable row level security;
create policy "campaigns: readable" on public.campaigns for select to anon, authenticated using (true);
revoke all on public.campaigns from anon, authenticated;
grant select on public.campaigns to anon, authenticated;

-- One project per standalone problem per learner (campaign projects stay unique per campaign).
create unique index projects_user_problem_idx on public.projects (user_id, content_id)
  where campaign_id is null and content_id is not null;
