-- Streaks and achievements (spec §37, §38). Both are computed from existing records:
--   * daily_activity: graded active seconds per day in the learner's timezone (an unknown zone
--     falls back to UTC rather than failing), for the streak rules in lib/engagement/streaks.ts;
--   * achievement_counts: the independent-evidence counts achievements are judged on.
-- Awards themselves go to achievement_awards (owner-readable, server-written, already exported).

create function public.daily_activity(p_user_id uuid, p_since date)
returns table (day date, active_seconds integer)
language sql
stable
security definer
set search_path = ''
as $$
  with zone as (
    select coalesce((select n.name from pg_catalog.pg_timezone_names n
                     join public.profiles p on p.timezone = n.name where p.user_id = p_user_id limit 1), 'UTC') as name
  ),
  local as (
    select (a.created_at at time zone zone.name)::date as day, a.active_seconds
    from public.attempts a, zone
    where a.user_id = p_user_id
      and a.state = 'graded'
      -- A day of slack covers any zone offset; the exact cut is on the local date below.
      and a.created_at >= p_since::timestamptz - interval '1 day'
  )
  select local.day, sum(local.active_seconds)::integer
  from local
  where local.day >= p_since
  group by local.day
  order by local.day;
$$;

create function public.achievement_counts(p_user_id uuid) returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'complexity_passes', (select count(*) from public.mastery_evidence e
                          where e.user_id = p_user_id and e.dimension = 'complexity' and e.outcome = 'pass' and e.independence = 'independent'),
    'recognition_passes', (select count(*) from public.mastery_evidence e
                           where e.user_id = p_user_id and e.dimension = 'recognition' and e.outcome = 'pass' and e.independence = 'independent'),
    -- Debug Dungeon quests (content ids "debug.*") solved without hints.
    'bugs_fixed', (select count(distinct cv.content_id) from public.attempts a join public.content_versions cv on cv.id = a.content_version_id
                   where a.user_id = p_user_id and cv.content_id like 'debug.%' and a.outcome = 'succeeded' and a.hint_level = 0),
    -- Design challenges with every follow-up probe answered.
    'designs_completed', (select count(distinct x.content_id) from (
                            select cv.content_id from public.attempts a join public.content_versions cv on cv.id = a.content_version_id
                            where a.user_id = p_user_id and a.state = 'graded' and cv.payload ? 'design'
                            group by cv.id, cv.content_id
                            having count(distinct a.response ->> 'questionId') >= max(jsonb_array_length(cv.payload -> 'questions'))) x),
    'fast_mocks', (select count(*) from public.mock_interviews m
                   where m.user_id = p_user_id and (m.result ->> 'solved')::boolean and (m.result ->> 'minutesUsed')::integer <= 25)
  );
$$;

revoke all on function public.daily_activity(uuid, date) from public, anon, authenticated;
revoke all on function public.achievement_counts(uuid) from public, anon, authenticated;
grant execute on function public.daily_activity(uuid, date) to service_role;
grant execute on function public.achievement_counts(uuid) to service_role;

-- Sets one key of profiles.settings atomically, so concurrent writes to other keys (e.g. the
-- drafts opt-in) are never lost to a read-modify-write.
create function public.set_profile_setting(p_user_id uuid, p_key text, p_value jsonb) returns void
language sql
security definer
set search_path = ''
as $$
  update public.profiles set settings = settings || jsonb_build_object(p_key, p_value), updated_at = now() where user_id = p_user_id;
$$;

revoke all on function public.set_profile_setting(uuid, text, jsonb) from public, anon, authenticated;
grant execute on function public.set_profile_setting(uuid, text, jsonb) to service_role;
