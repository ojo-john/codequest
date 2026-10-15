-- Behavioral story bank (spec §35): the learner's own true stories in STAR form, tagged with the
-- competencies they show. The app checks structure only and never writes story content. Stories
-- are learner-authored, so like notes they are always exported and always imported (signed or
-- not); delete removes them with the rest of the learner's data.

create table public.behavioral_stories (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (user_id) on delete cascade,
  title text not null check (char_length(title) between 1 and 120),
  competencies text[] not null default '{}' check (cardinality(competencies) <= 6),
  situation text not null default '' check (char_length(situation) <= 4000),
  task text not null default '' check (char_length(task) <= 4000),
  action text not null default '' check (char_length(action) <= 4000),
  result text not null default '' check (char_length(result) <= 4000),
  learned text not null default '' check (char_length(learned) <= 4000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index behavioral_stories_user_idx on public.behavioral_stories (user_id, updated_at desc);

alter table public.behavioral_stories enable row level security;
create policy "behavioral_stories: owner reads" on public.behavioral_stories for select to authenticated using ((select auth.uid()) = user_id);
revoke all on public.behavioral_stories from anon, authenticated;
grant select on public.behavioral_stories to authenticated;

-- ---------------------------------------------------------------------------------------------
-- Data portability. The export key is present only when there are stories, so application code
-- that predates this table (with a strict archive schema) keeps exporting between the schema
-- change and the deploy.
-- ---------------------------------------------------------------------------------------------

alter function public.export_user_data(uuid) rename to export_user_data_v3;
alter function public.import_user_data(uuid, jsonb, boolean) rename to import_user_data_v3;
alter function public.delete_user_data(uuid) rename to delete_user_data_v2;

create function public.export_user_data(p_user_id uuid) returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select public.export_user_data_v3(p_user_id) || coalesce((
    select jsonb_build_object('behavioral_stories', jsonb_agg(jsonb_build_object(
        'id', s.id, 'title', s.title, 'competencies', to_jsonb(s.competencies), 'situation', s.situation, 'task', s.task,
        'action', s.action, 'result', s.result, 'learned', s.learned, 'created_at', s.created_at, 'updated_at', s.updated_at)
        order by s.created_at, s.id))
    from public.behavioral_stories s
    where s.user_id = p_user_id
    having count(*) > 0), '{}'::jsonb);
$$;

create function public.import_user_data(p_user_id uuid, p_data jsonb, p_include_progress boolean) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_report jsonb;
  v_total integer;
  v_done integer;
begin
  v_report := public.import_user_data_v3(p_user_id, p_data, p_include_progress);

  select count(*) into v_total from jsonb_array_elements(coalesce(p_data -> 'behavioral_stories', '[]'));
  with inserted as (
    insert into public.behavioral_stories (id, user_id, title, competencies, situation, task, action, result, learned, created_at, updated_at)
      select x.id, p_user_id, x.title, array(select jsonb_array_elements_text(x.competencies)), x.situation, x.task, x.action,
             x.result, x.learned, x.created_at, x.updated_at
      from jsonb_to_recordset(coalesce(p_data -> 'behavioral_stories', '[]'))
        as x(id uuid, title text, competencies jsonb, situation text, task text, action text, result text, learned text,
             created_at timestamptz, updated_at timestamptz)
      on conflict do nothing
      returning 1)
  select count(*) into v_done from inserted;
  return v_report || jsonb_build_object('behavioral_stories', jsonb_build_object('imported', v_done, 'skipped', v_total - v_done));
end;
$$;

create function public.delete_user_data(p_user_id uuid) returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  delete from public.behavioral_stories where user_id = p_user_id;
  perform public.delete_user_data_v2(p_user_id);
end;
$$;

revoke all on function public.export_user_data_v3(uuid) from public, anon, authenticated;
revoke all on function public.import_user_data_v3(uuid, jsonb, boolean) from public, anon, authenticated;
revoke all on function public.delete_user_data_v2(uuid) from public, anon, authenticated;
revoke all on function public.export_user_data(uuid) from public, anon, authenticated;
revoke all on function public.import_user_data(uuid, jsonb, boolean) from public, anon, authenticated;
revoke all on function public.delete_user_data(uuid) from public, anon, authenticated;
grant execute on function public.export_user_data(uuid) to service_role;
grant execute on function public.import_user_data(uuid, jsonb, boolean) to service_role;
grant execute on function public.delete_user_data(uuid) to service_role;
