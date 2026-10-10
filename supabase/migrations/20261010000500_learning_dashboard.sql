-- Dashboard statistics (spec §40): one read of the learner's evidence and coding attempts.
-- Coding problems are attempts with an execution job; exercises have none.

create function public.learning_dashboard(p_user_id uuid) returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with coding as (
    select a.content_version_id, v.content_id, a.outcome, a.hint_level, a.active_seconds, a.created_at,
           row_number() over (partition by v.content_id order by a.created_at, a.id) as nth
    from public.attempts a
    join public.content_versions v on v.id = a.content_version_id
    where a.user_id = p_user_id and a.state = 'graded' and a.execution_job_id is not null
  )
  select jsonb_build_object(
    'evidence_by_dimension', coalesce((
      select jsonb_object_agg(dimension, jsonb_build_object('total', total, 'passed', passed))
      from (select e.dimension::text as dimension, count(*) as total, count(*) filter (where e.outcome = 'pass') as passed
            from public.mastery_evidence e where e.user_id = p_user_id group by e.dimension) d), '{}'::jsonb),
    'problems_attempted', (select count(distinct content_id) from coding),
    'problems_solved', (select count(distinct content_id) from coding where outcome = 'succeeded'),
    'independent_solves', (select count(distinct content_id) from coding where outcome = 'succeeded' and hint_level = 0),
    'first_attempt_passes', (select count(*) from coding where nth = 1 and outcome = 'succeeded'),
    'median_solve_seconds', (select percentile_cont(0.5) within group (order by active_seconds) from coding where outcome = 'succeeded'),
    'solve_time_sample', (select count(*) from coding where outcome = 'succeeded'),
    'recent_evidence', coalesce((
      select jsonb_agg(jsonb_build_object('skill_id', r.skill_id, 'dimension', r.dimension, 'outcome', r.outcome, 'independence', r.independence, 'created_at', r.created_at) order by r.created_at desc)
      from (select * from public.mastery_evidence e where e.user_id = p_user_id order by e.created_at desc, e.id limit 10) r), '[]'::jsonb)
  );
$$;

revoke all on function public.learning_dashboard(uuid) from public, anon, authenticated;
grant execute on function public.learning_dashboard(uuid) to service_role;
