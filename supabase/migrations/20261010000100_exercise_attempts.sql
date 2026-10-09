-- Exercise attempts (spec §43): one attempt per answered question, recorded with its evidence,
-- skill states and XP in one transaction. Idempotent per client request key (kept in the
-- attempt's response), so a retried request returns the original result instead of recording
-- the answer twice. Archive import inserts with "on conflict do nothing", so this unique index
-- also keeps re-imports idempotent.

create unique index attempts_request_key_unique on public.attempts (user_id, (response ->> 'request_key'))
  where response ? 'request_key';

create function public.record_exercise_attempt(
  p_user_id uuid,
  p_content_version_id uuid,
  p_request_key text,
  p_response jsonb,
  p_active_seconds integer,
  p_outcome text,
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
  v_delta integer;
  v_awarded integer := 0;
begin
  select id into v_attempt_id from public.attempts
    where user_id = p_user_id and response ->> 'request_key' = p_request_key;
  if found then
    return jsonb_build_object('attempt_id', v_attempt_id, 'awarded_xp', 0, 'replayed', true);
  end if;

  begin
    insert into public.attempts (user_id, content_version_id, response, hint_level, active_seconds, state, outcome, graded_at)
      values (p_user_id, p_content_version_id, p_response || jsonb_build_object('request_key', p_request_key), 0,
              p_active_seconds, 'graded', p_outcome, now())
      returning id into v_attempt_id;
  exception when unique_violation then
    -- A concurrent request with the same key won the race; report its attempt.
    select id into v_attempt_id from public.attempts
      where user_id = p_user_id and response ->> 'request_key' = p_request_key;
    return jsonb_build_object('attempt_id', v_attempt_id, 'awarded_xp', 0, 'replayed', true);
  end;

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

  for v_item in select * from jsonb_array_elements(p_xp) loop
    v_delta := null;
    insert into public.xp_ledger (user_id, event_key, delta)
      values (p_user_id, v_item ->> 'event_key', (v_item ->> 'delta')::integer)
      on conflict (user_id, event_key) do nothing
      returning delta into v_delta;
    v_awarded := v_awarded + coalesce(v_delta, 0);
  end loop;

  return jsonb_build_object('attempt_id', v_attempt_id, 'awarded_xp', v_awarded, 'replayed', false);
end;
$$;

revoke all on function public.record_exercise_attempt(uuid, uuid, text, jsonb, integer, text, jsonb, jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.record_exercise_attempt(uuid, uuid, text, jsonb, integer, text, jsonb, jsonb, jsonb) to service_role;
