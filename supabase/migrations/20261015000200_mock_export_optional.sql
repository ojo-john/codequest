-- Export carries mock_interviews only when the learner has any. An always-present key broke
-- exports on application code that predates mocks (its archive schema is strict), between this
-- schema change and the matching deploy; omitting an empty key keeps the change additive. The
-- archive schema treats the key as optional, so both shapes import.

create or replace function public.export_user_data(p_user_id uuid) returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select public.export_user_data_v2(p_user_id) || coalesce((
    select jsonb_build_object('mock_interviews', jsonb_agg(jsonb_build_object(
        'id', m.id, 'kind', m.kind, 'duration_minutes', m.duration_minutes,
        'content_id', cv.content_id, 'content_version', cv.version, 'request_key', m.request_key,
        'plan', m.plan, 'started_at', m.started_at, 'ends_at', m.ends_at, 'finished_at', m.finished_at,
        'result', m.result) order by m.started_at, m.id))
    from public.mock_interviews m join public.content_versions cv on cv.id = m.content_version_id
    where m.user_id = p_user_id
    having count(*) > 0), '{}'::jsonb);
$$;

revoke all on function public.export_user_data(uuid) from public, anon, authenticated;
grant execute on function public.export_user_data(uuid) to service_role;
