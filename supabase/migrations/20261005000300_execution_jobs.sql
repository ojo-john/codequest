-- CodeQuest schema, part 3: execution jobs and the usage ledger (spec §64, §66–67).
--
-- execution_jobs is both the durable job record and the quota ledger: each admitted job carries
-- a worst-case CPU reservation until it settles with the measured value.
--
-- The admission POLICY lives in TypeScript (lib/execution/budget.ts) — single source of truth.
-- The database supplies atomicity with optimistic concurrency: the server reads a usage
-- snapshot (with a usage_version), decides, then reserves conditional on the version being
-- unchanged; on a conflict it re-reads and decides again. All functions are server-only.

create type public.execution_state as enum (
  'created', 'provisioning', 'compiling', 'running', 'grading',
  'succeeded', 'wrong_answer', 'compile_error', 'runtime_error', 'timeout', 'cancelled', 'infrastructure_error'
);

create table public.execution_jobs (
  id uuid primary key,
  user_id uuid not null references public.profiles (user_id) on delete cascade,
  attempt_id uuid references public.attempts (id) on delete set null,
  -- POST /api/executions idempotency (spec §67).
  idempotency_key text check (char_length(idempotency_key) between 8 and 100),
  grading_mode text check (grading_mode in ('junit', 'contract')),
  image_ref text,
  state public.execution_state not null default 'created',
  outcome_detail text check (char_length(outcome_detail) <= 100),
  -- Bounded learner-visible output (harness caps at 64 KB).
  limited_logs text check (octet_length(limited_logs) <= 70000),
  reserved_cpu_seconds numeric(10, 3) not null check (reserved_cpu_seconds > 0),
  settled_cpu_seconds numeric(10, 3) check (settled_cpu_seconds >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, idempotency_key)
);

create index execution_jobs_created_idx on public.execution_jobs (created_at);
create index execution_jobs_user_created_idx on public.execution_jobs (user_id, created_at desc);
create index execution_jobs_unsettled_idx on public.execution_jobs (user_id) where settled_cpu_seconds is null;

create trigger execution_jobs_touch before update on public.execution_jobs
  for each row execute function public.touch_updated_at();

-- Singleton: global pause (provider quota exhausted) and the optimistic-concurrency version.
-- Statements on it always say `where singleton`: PostgREST requests load pg-safeupdate, which
-- rejects UPDATE/DELETE without a WHERE clause.
create table private.execution_controls (
  singleton boolean primary key default true check (singleton),
  paused_until timestamptz,
  usage_version bigint not null default 0
);
insert into private.execution_controls default values;

alter table public.execution_jobs enable row level security;
create policy "execution_jobs: owner reads" on public.execution_jobs for select to authenticated
  using ((select auth.uid()) = user_id);
revoke all on public.execution_jobs from anon, authenticated;
grant select on public.execution_jobs to authenticated;

-- ---------------------------------------------------------------------------------------------
-- Ledger functions (service_role only)
-- ---------------------------------------------------------------------------------------------

create function public.execution_usage_snapshot(p_user_id uuid, p_now timestamptz)
returns table (
  jobs_today bigint,
  jobs_this_month bigint,
  settled_cpu_seconds_this_month numeric,
  reserved_cpu_seconds numeric,
  active_jobs_for_user bigint,
  paused_until timestamptz,
  usage_version bigint
)
language sql
stable
security definer
set search_path = ''
as $$
  with bounds as (
    -- UTC calendar day/month, matching lib/execution/budget.ts.
    select
      (date_trunc('day', p_now at time zone 'UTC') at time zone 'UTC') as day_start,
      (date_trunc('month', p_now at time zone 'UTC') at time zone 'UTC') as month_start
  )
  select
    (select count(*) from public.execution_jobs j, bounds b where j.created_at >= b.day_start),
    (select count(*) from public.execution_jobs j, bounds b where j.created_at >= b.month_start),
    (select coalesce(sum(j.settled_cpu_seconds), 0) from public.execution_jobs j, bounds b
       where j.created_at >= b.month_start and j.settled_cpu_seconds is not null),
    (select coalesce(sum(j.reserved_cpu_seconds), 0) from public.execution_jobs j where j.settled_cpu_seconds is null),
    (select count(*) from public.execution_jobs j where j.user_id = p_user_id and j.settled_cpu_seconds is null),
    c.paused_until,
    c.usage_version
  from private.execution_controls c;
$$;

-- Returns 'reserved', or 'conflict' when usage changed since the caller's snapshot.
create function public.reserve_execution_job(
  p_job_id uuid,
  p_user_id uuid,
  p_now timestamptz,
  p_reserve_cpu_seconds numeric,
  p_expected_usage_version bigint
) returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_version bigint;
begin
  select usage_version into v_version from private.execution_controls where singleton for update;
  if v_version <> p_expected_usage_version then
    return 'conflict';
  end if;
  insert into public.execution_jobs (id, user_id, reserved_cpu_seconds, created_at)
    values (p_job_id, p_user_id, p_reserve_cpu_seconds, p_now);
  update private.execution_controls set usage_version = usage_version + 1 where singleton;
  return 'reserved';
end;
$$;

-- Idempotent: only the first settlement of a job counts.
create function public.settle_execution_job(p_job_id uuid, p_cpu_seconds numeric) returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (select 1 from public.execution_jobs where id = p_job_id) then
    raise exception 'job % was never admitted', p_job_id using errcode = 'P0002';
  end if;
  update public.execution_jobs set settled_cpu_seconds = p_cpu_seconds
    where id = p_job_id and settled_cpu_seconds is null;
  if found then
    update private.execution_controls set usage_version = usage_version + 1 where singleton;
  end if;
end;
$$;

-- Extends (never shortens) the global pause.
create function public.pause_executions(p_until timestamptz) returns void
language sql
security definer
set search_path = ''
as $$
  update private.execution_controls
    set paused_until = greatest(coalesce(paused_until, p_until), p_until),
        usage_version = usage_version + 1
    where singleton;
$$;

revoke all on function public.execution_usage_snapshot(uuid, timestamptz) from public, anon, authenticated;
revoke all on function public.reserve_execution_job(uuid, uuid, timestamptz, numeric, bigint) from public, anon, authenticated;
revoke all on function public.settle_execution_job(uuid, numeric) from public, anon, authenticated;
revoke all on function public.pause_executions(timestamptz) from public, anon, authenticated;
grant execute on function public.execution_usage_snapshot(uuid, timestamptz) to service_role;
grant execute on function public.reserve_execution_job(uuid, uuid, timestamptz, numeric, bigint) to service_role;
grant execute on function public.settle_execution_job(uuid, numeric) to service_role;
grant execute on function public.pause_executions(timestamptz) to service_role;
