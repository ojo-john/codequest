-- Mock interviews (spec §33, §34): a timed coding interview on an unseen problem with study aids
-- off. The plan holds the learner's interview workflow notes (clarify, examples, approaches,
-- complexity); the result is the practice-rubric scoring, computed by the server when the mock
-- is finished (or found expired). At most one unfinished mock per learner; while it runs and
-- before it ends, hints for its problem are refused.

create table public.mock_interviews (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (user_id) on delete cascade,
  kind text not null check (kind = 'coding'),
  duration_minutes smallint not null check (duration_minutes in (45, 60)),
  content_version_id uuid not null references public.content_versions (id) on delete restrict,
  request_key text not null check (char_length(request_key) between 8 and 80),
  plan jsonb not null default '{}'::jsonb check (jsonb_typeof(plan) = 'object' and pg_column_size(plan) <= 20000),
  started_at timestamptz not null default now(),
  ends_at timestamptz not null,
  finished_at timestamptz,
  result jsonb check (result is null or (jsonb_typeof(result) = 'object' and pg_column_size(result) <= 20000)),
  check (ends_at > started_at),
  check ((finished_at is null) = (result is null)),
  unique (user_id, request_key)
);

create unique index mock_interviews_one_unfinished on public.mock_interviews (user_id) where finished_at is null;
create index mock_interviews_user_started_idx on public.mock_interviews (user_id, started_at desc);

alter table public.mock_interviews enable row level security;
create policy "mock_interviews: owner reads" on public.mock_interviews for select to authenticated using ((select auth.uid()) = user_id);
revoke all on public.mock_interviews from anon, authenticated;
grant select on public.mock_interviews to authenticated;

-- ---------------------------------------------------------------------------------------------
-- Data portability. Export carries mocks with their content reference; import (progress only)
-- restores them onto content versions that exist here, finished only (an imported mock never
-- becomes the running one); delete removes them with the rest of the learner's progress.
-- ---------------------------------------------------------------------------------------------

alter function public.export_user_data(uuid) rename to export_user_data_v2;
alter function public.import_user_data(uuid, jsonb, boolean) rename to import_user_data_v2;
alter function public.delete_user_data(uuid) rename to delete_user_data_base;

create function public.export_user_data(p_user_id uuid) returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select public.export_user_data_v2(p_user_id) || jsonb_build_object(
    'mock_interviews', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', m.id, 'kind', m.kind, 'duration_minutes', m.duration_minutes,
        'content_id', cv.content_id, 'content_version', cv.version, 'request_key', m.request_key,
        'plan', m.plan, 'started_at', m.started_at, 'ends_at', m.ends_at, 'finished_at', m.finished_at,
        'result', m.result) order by m.started_at, m.id)
      from public.mock_interviews m join public.content_versions cv on cv.id = m.content_version_id
      where m.user_id = p_user_id), '[]'::jsonb));
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
  v_report := public.import_user_data_v2(p_user_id, p_data, p_include_progress);
  if not p_include_progress then
    return v_report;
  end if;

  select count(*) into v_total from jsonb_array_elements(coalesce(p_data -> 'mock_interviews', '[]'));
  with inserted as (
    insert into public.mock_interviews (id, user_id, kind, duration_minutes, content_version_id, request_key, plan,
                                        started_at, ends_at, finished_at, result)
      select x.id, p_user_id, x.kind, x.duration_minutes, cv.id, x.request_key, x.plan,
             x.started_at, x.ends_at, x.finished_at, x.result
      from jsonb_to_recordset(coalesce(p_data -> 'mock_interviews', '[]'))
        as x(id uuid, kind text, duration_minutes smallint, content_id text, content_version integer, request_key text,
             plan jsonb, started_at timestamptz, ends_at timestamptz, finished_at timestamptz, result jsonb)
      join public.content_versions cv on cv.content_id = x.content_id and cv.version = x.content_version
      where x.finished_at is not null and x.result is not null
      on conflict do nothing
      returning 1)
  select count(*) into v_done from inserted;
  return v_report || jsonb_build_object('mock_interviews', jsonb_build_object('imported', v_done, 'skipped', v_total - v_done));
end;
$$;

create function public.delete_user_data(p_user_id uuid) returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  delete from public.mock_interviews where user_id = p_user_id;
  perform public.delete_user_data_base(p_user_id);
end;
$$;

revoke all on function public.export_user_data_v2(uuid) from public, anon, authenticated;
revoke all on function public.import_user_data_v2(uuid, jsonb, boolean) from public, anon, authenticated;
revoke all on function public.delete_user_data_base(uuid) from public, anon, authenticated;
revoke all on function public.export_user_data(uuid) from public, anon, authenticated;
revoke all on function public.import_user_data(uuid, jsonb, boolean) from public, anon, authenticated;
revoke all on function public.delete_user_data(uuid) from public, anon, authenticated;
grant execute on function public.export_user_data(uuid) to service_role;
grant execute on function public.import_user_data(uuid, jsonb, boolean) to service_role;
grant execute on function public.delete_user_data(uuid) to service_role;
