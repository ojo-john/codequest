-- Usage screen and stale reservations (spec §64).
--
-- 1. A job's reservation is released when the executing function settles it. A function that
--    dies first (killed at its maximum duration, crashed, redeployed) never settles, and the job
--    would keep holding CPU budget and the learner's only active-job slot forever. Reclaiming
--    settles such jobs at their reservation (the worst case: never under-charge the quota) and
--    marks them infrastructure_error/abandoned. Called before every admission and usage read.
-- 2. The database's size, for the usage screen (Supabase Free: 500 MB).

create function public.reclaim_stale_executions(p_stale_before timestamptz) returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_reclaimed integer;
begin
  update public.execution_jobs
    set settled_cpu_seconds = reserved_cpu_seconds,
        state = case when state in ('succeeded', 'wrong_answer', 'compile_error', 'runtime_error', 'timeout', 'cancelled', 'infrastructure_error')
                     then state else 'infrastructure_error'::public.execution_state end,
        outcome_detail = coalesce(outcome_detail, 'abandoned')
    where settled_cpu_seconds is null and created_at < p_stale_before;
  get diagnostics v_reclaimed = row_count;
  if v_reclaimed > 0 then
    update private.execution_controls set usage_version = usage_version + 1 where singleton;
  end if;
  return v_reclaimed;
end;
$$;

create function public.database_size_bytes() returns bigint
language sql
stable
security definer
set search_path = ''
as $$
  select pg_database_size(current_database());
$$;

revoke all on function public.reclaim_stale_executions(timestamptz) from public, anon, authenticated;
revoke all on function public.database_size_bytes() from public, anon, authenticated;
grant execute on function public.reclaim_stale_executions(timestamptz) to service_role;
grant execute on function public.database_size_bytes() to service_role;
