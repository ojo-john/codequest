-- Session completion and exact XP reporting (spec §5, §36).
--
-- record_graded_attempt now:
--   * completes a session item only on a passing submission (a failed one marks it in progress),
--   * completes the session once every item is completed or skipped,
--   * returns what it actually did: {attempt_id, awarded_xp, session_completed}. awarded_xp counts
--     only ledger rows this call inserted, so "+50 XP" is never shown for XP already earned.
-- The return type changes, so the function is dropped and recreated with the same grants.

drop function public.record_graded_attempt(uuid, uuid, uuid, uuid, jsonb, smallint, integer, public.attempt_state, text, text, jsonb, jsonb, jsonb);

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
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_attempt_id uuid;
  v_item jsonb;
  v_awarded integer := 0;
  v_delta integer;
  v_session_id uuid;
  v_session_completed boolean := false;
begin
  -- Replayed job: report the original attempt and award nothing new.
  select id into v_attempt_id from public.attempts where execution_job_id = p_execution_job_id;
  if found then
    return jsonb_build_object('attempt_id', v_attempt_id, 'awarded_xp', 0, 'session_completed', false);
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
    v_delta := null;
    insert into public.xp_ledger (user_id, event_key, delta)
      values (p_user_id, v_item ->> 'event_key', (v_item ->> 'delta')::integer)
      on conflict (user_id, event_key) do nothing
      returning delta into v_delta;
    v_awarded := v_awarded + coalesce(v_delta, 0);
  end loop;

  if p_session_item_id is not null and p_state = 'graded' then
    update public.session_items si
      set state = case when p_outcome = 'succeeded' then 'completed'::public.session_item_state
                       when si.state = 'pending' then 'in_progress'::public.session_item_state
                       else si.state end
      where si.id = p_session_item_id
        and si.state <> 'completed'
        and exists (select 1 from public.sessions s where s.id = si.session_id and s.user_id = p_user_id)
      returning si.session_id into v_session_id;

    if v_session_id is not null then
      update public.sessions s
        set state = 'completed', completed_at = now()
        where s.id = v_session_id
          and s.state = 'active'
          and not exists (select 1 from public.session_items si
                          where si.session_id = s.id and si.state not in ('completed', 'skipped'));
      v_session_completed := found;
    end if;
  end if;

  return jsonb_build_object('attempt_id', v_attempt_id, 'awarded_xp', v_awarded, 'session_completed', v_session_completed);
end;
$$;

revoke all on function public.record_graded_attempt(uuid, uuid, uuid, uuid, jsonb, smallint, integer, public.attempt_state, text, text, jsonb, jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.record_graded_attempt(uuid, uuid, uuid, uuid, jsonb, smallint, integer, public.attempt_state, text, text, jsonb, jsonb, jsonb) to service_role;
