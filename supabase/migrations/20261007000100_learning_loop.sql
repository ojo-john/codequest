-- CodeQuest schema, part 4: the learning loop (spec §5, §15, §21–22, §36, §62, §67, §70).

-- ---------------------------------------------------------------------------------------------
-- Unreviewed content: visible only to learners who opt in, and always labelled in the UI
-- (spec §44: "Clearly label generated, unreviewed content"). Published content is unchanged.
-- ---------------------------------------------------------------------------------------------

-- SECURITY DEFINER so the policy works for anonymous viewers too (they can't read profiles);
-- it only ever reveals the caller's own opt-in flag, and is false without a signed-in user.
create function public.viewer_shows_unreviewed() returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (select (p.settings ->> 'show_unreviewed_content') = 'true' from public.profiles p where p.user_id = auth.uid()),
    false);
$$;
revoke all on function public.viewer_shows_unreviewed() from public;
grant execute on function public.viewer_shows_unreviewed() to anon, authenticated;

drop policy "content_versions: published readable" on public.content_versions;
create policy "content_versions: published, or unreviewed for opted-in learners" on public.content_versions
  for select to anon, authenticated using (
    status = 'published'
    or (status in ('draft', 'ai_reviewed', 'human_reviewed') and (select public.viewer_shows_unreviewed()))
  );

drop policy "content_skill_tags: published readable" on public.content_skill_tags;
create policy "content_skill_tags: readable with their version" on public.content_skill_tags
  for select to anon, authenticated using (
    exists (select 1 from public.content_versions v where v.id = content_version_id)
  );

-- ---------------------------------------------------------------------------------------------
-- Projects belong to a campaign so the same code carries from quest to quest (spec §69).
-- ---------------------------------------------------------------------------------------------

alter table public.projects add column campaign_id text check (campaign_id ~ '^[a-z0-9]+(\.[a-z0-9-]+)*$');
create unique index projects_user_campaign_idx on public.projects (user_id, campaign_id) where campaign_id is not null;
grant insert (user_id, content_id, title, campaign_id) on public.projects to authenticated;

-- ---------------------------------------------------------------------------------------------
-- Hints are served by the server one tier at a time and recorded, so independence evidence is
-- honest (spec §15, §70: no XP penalty — the tier only changes how the success counts).
-- ---------------------------------------------------------------------------------------------

create table public.hint_requests (
  user_id uuid not null references public.profiles (user_id) on delete cascade,
  content_version_id uuid not null references public.content_versions (id) on delete restrict,
  tier smallint not null check (tier between 1 and 5),
  requested_at timestamptz not null default now(),
  primary key (user_id, content_version_id, tier)
);

alter table public.hint_requests enable row level security;
create policy "hint_requests: owner reads" on public.hint_requests for select to authenticated
  using ((select auth.uid()) = user_id);
revoke all on public.hint_requests from anon, authenticated;
grant select on public.hint_requests to authenticated;

-- ---------------------------------------------------------------------------------------------
-- Attempts: one per graded execution job, so a retried or replayed submission can't create a
-- second attempt, second evidence or second XP award (spec §66, §68).
-- ---------------------------------------------------------------------------------------------

alter table public.attempts add column execution_job_id uuid unique references public.execution_jobs (id) on delete set null;

-- The trusted server computes outcome, evidence, schedule and XP (lib/learning) and records them
-- here in ONE transaction. Idempotent per execution job.
create function public.record_graded_attempt(
  p_user_id uuid,
  p_execution_job_id uuid,
  p_content_version_id uuid,
  p_session_item_id uuid,
  p_response jsonb,
  p_hint_level smallint,
  p_active_seconds integer,
  p_state public.attempt_state,
  p_outcome text,
  p_rubric_version text,
  p_evidence jsonb,
  p_skill_states jsonb,
  p_xp jsonb
) returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_attempt_id uuid;
  v_item jsonb;
begin
  select id into v_attempt_id from public.attempts where execution_job_id = p_execution_job_id;
  if found then
    return v_attempt_id;
  end if;

  insert into public.attempts (user_id, session_item_id, content_version_id, response, hint_level,
                               active_seconds, state, outcome, rubric_version, graded_at, execution_job_id)
    values (p_user_id, p_session_item_id, p_content_version_id, p_response, p_hint_level,
            p_active_seconds, p_state, p_outcome, p_rubric_version,
            case when p_state = 'graded' then now() end, p_execution_job_id)
    returning id into v_attempt_id;

  for v_item in select * from jsonb_array_elements(p_evidence) loop
    insert into public.mastery_evidence (user_id, attempt_id, skill_id, dimension, outcome, independence, model_version)
      values (p_user_id, v_attempt_id, v_item ->> 'skill_id', (v_item ->> 'dimension')::public.skill_dimension,
              (v_item ->> 'outcome')::public.evidence_outcome, (v_item ->> 'independence')::public.independence,
              v_item ->> 'model_version');
  end loop;

  for v_item in select * from jsonb_array_elements(p_skill_states) loop
    insert into public.user_skill_state (user_id, skill_id, dimension, estimate, evidence_count, review_due_at,
                                         scheduler_version, model_version, updated_at)
      values (p_user_id, v_item ->> 'skill_id', (v_item ->> 'dimension')::public.skill_dimension,
              (v_item ->> 'estimate')::numeric, (v_item ->> 'evidence_count')::integer,
              (v_item ->> 'review_due_at')::timestamptz, v_item ->> 'scheduler_version', v_item ->> 'model_version', now())
      on conflict (user_id, skill_id, dimension) do update set
        estimate = excluded.estimate, evidence_count = excluded.evidence_count, review_due_at = excluded.review_due_at,
        scheduler_version = excluded.scheduler_version, model_version = excluded.model_version, updated_at = now();
  end loop;

  -- The unique (user_id, event_key) makes every award at-most-once, forever.
  for v_item in select * from jsonb_array_elements(p_xp) loop
    insert into public.xp_ledger (user_id, event_key, delta)
      values (p_user_id, v_item ->> 'event_key', (v_item ->> 'delta')::integer)
      on conflict (user_id, event_key) do nothing;
  end loop;

  if p_session_item_id is not null and p_state = 'graded' then
    update public.session_items set state = 'completed'
      where id = p_session_item_id
        and exists (select 1 from public.sessions s where s.id = session_id and s.user_id = p_user_id);
  end if;

  return v_attempt_id;
end;
$$;

-- Server-side hint ladder: records the next tier and returns it (or the current one when all
-- tiers are used). Learners never write hint_requests directly.
create function public.record_hint_request(p_user_id uuid, p_content_version_id uuid, p_max_tier smallint) returns smallint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_next smallint;
begin
  select coalesce(max(tier), 0) + 1 into v_next from public.hint_requests
    where user_id = p_user_id and content_version_id = p_content_version_id;
  if v_next > p_max_tier then
    return p_max_tier;
  end if;
  insert into public.hint_requests (user_id, content_version_id, tier) values (p_user_id, p_content_version_id, v_next)
    on conflict do nothing;
  return v_next;
end;
$$;

-- Idempotent session creation (POST /api/sessions with a client request key, spec §67).
create function public.create_session(
  p_user_id uuid,
  p_budget_minutes smallint,
  p_client_request_key text,
  p_policy_version text,
  p_items jsonb
) returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_session_id uuid;
  v_item jsonb;
  v_ordinal smallint := 0;
begin
  select id into v_session_id from public.sessions where user_id = p_user_id and client_request_key = p_client_request_key;
  if found then
    return v_session_id;
  end if;
  insert into public.sessions (user_id, budget_minutes, client_request_key, policy_version)
    values (p_user_id, p_budget_minutes, p_client_request_key, p_policy_version)
    returning id into v_session_id;
  for v_item in select * from jsonb_array_elements(p_items) loop
    insert into public.session_items (session_id, content_version_id, ordinal, estimated_minutes)
      values (v_session_id, (v_item ->> 'content_version_id')::uuid, v_ordinal, (v_item ->> 'estimated_minutes')::smallint);
    v_ordinal := v_ordinal + 1;
  end loop;
  return v_session_id;
end;
$$;

revoke all on function public.record_graded_attempt(uuid, uuid, uuid, uuid, jsonb, smallint, integer, public.attempt_state, text, text, jsonb, jsonb, jsonb) from public, anon, authenticated;
revoke all on function public.record_hint_request(uuid, uuid, smallint) from public, anon, authenticated;
revoke all on function public.create_session(uuid, smallint, text, text, jsonb) from public, anon, authenticated;
grant execute on function public.record_graded_attempt(uuid, uuid, uuid, uuid, jsonb, smallint, integer, public.attempt_state, text, text, jsonb, jsonb, jsonb) to service_role;
grant execute on function public.record_hint_request(uuid, uuid, smallint) to service_role;
grant execute on function public.create_session(uuid, smallint, text, text, jsonb) to service_role;

-- Recommendations are recorded alongside their session (spec §61: reasons + evidence).
create function public.record_recommendation(
  p_user_id uuid, p_session_id uuid, p_reason_codes text[], p_evidence_ids uuid[], p_policy_version text
) returns uuid
language sql
security definer
set search_path = ''
as $$
  insert into public.recommendations (user_id, session_id, reason_codes, evidence_ids, policy_version)
  values (p_user_id, p_session_id, p_reason_codes, p_evidence_ids, p_policy_version)
  returning id;
$$;
revoke all on function public.record_recommendation(uuid, uuid, text[], uuid[], text) from public, anon, authenticated;
grant execute on function public.record_recommendation(uuid, uuid, text[], uuid[], text) to service_role;

-- Hidden grading for one content version (private schema isn't exposed over the API, even to the
-- server key). Server-only.
create function public.get_content_grading(p_content_version_id uuid) returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select hidden_grading from private.content_secrets where content_version_id = p_content_version_id;
$$;
revoke all on function public.get_content_grading(uuid) from public, anon, authenticated;
grant execute on function public.get_content_grading(uuid) to service_role;

-- The learner-facing result of a finished job, so a reload can show it again (spec §48, §67).
-- Bounded; hidden cases appear only as id + pass/fail.
alter table public.execution_jobs add column result jsonb check (result is null or octet_length(result::text) <= 200000);
