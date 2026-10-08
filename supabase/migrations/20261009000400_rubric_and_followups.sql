-- Rubric v1 and follow-up questions (spec §14, §43, §46).
--
-- Follow-up questions are asked after a passing submission and graded deterministically against
-- canonical answers held in the quest's hidden grading. One answer per (attempt, question): the
-- first answer counts, so re-answering can't farm evidence. Answers belong to an attempt and are
-- deleted with it (and so with delete_user_data, which deletes attempts).

insert into public.rubric_versions (id, definition) values (
  'rubric-v1',
  '{"weights": {"correctness": 40, "algorithm_choice": 15, "time_complexity": 10, "space_complexity": 10, "code_quality": 10, "edge_cases": 5, "explanation": 10},
    "notes": "Correctness and edge cases from hidden checks; explanation and complexity from follow-up questions with canonical answers; algorithm choice and code quality are not assessed until reviewed reasoning exists. Unassessed criteria are reported as such, never as zero."}'
) on conflict (id) do nothing;

create table public.followup_answers (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (user_id) on delete cascade,
  attempt_id uuid not null references public.attempts (id) on delete cascade,
  followup_id text not null check (char_length(followup_id) between 1 and 60),
  choice smallint not null check (choice between 0 and 9),
  correct boolean not null,
  created_at timestamptz not null default now(),
  unique (attempt_id, followup_id)
);

create index followup_answers_user_idx on public.followup_answers (user_id, created_at desc);

alter table public.followup_answers enable row level security;
create policy "followup_answers: owner reads" on public.followup_answers for select to authenticated using ((select auth.uid()) = user_id);
revoke all on public.followup_answers from anon, authenticated;
grant select on public.followup_answers to authenticated;

-- Records a learner's answers to an attempt's follow-ups with the evidence and skill states they
-- produce, atomically. Raises CQ409 (and records nothing) if any of these questions was already
-- answered for this attempt, or if the attempt is not the learner's.
create function public.record_followup_answers(
  p_user_id uuid,
  p_attempt_id uuid,
  p_answers jsonb,
  p_evidence jsonb,
  p_skill_states jsonb
) returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_item jsonb;
  v_expected integer := jsonb_array_length(p_answers);
  v_inserted integer;
begin
  if not exists (select 1 from public.attempts where id = p_attempt_id and user_id = p_user_id) then
    raise exception 'attempt is not this learner''s' using errcode = 'CQ409';
  end if;

  insert into public.followup_answers (user_id, attempt_id, followup_id, choice, correct)
    select p_user_id, p_attempt_id, x.followup_id, x.choice, x.correct
    from jsonb_to_recordset(p_answers) as x(followup_id text, choice smallint, correct boolean)
    on conflict (attempt_id, followup_id) do nothing;
  get diagnostics v_inserted = row_count;
  if v_inserted <> v_expected then
    raise exception 'follow-ups already answered for this attempt' using errcode = 'CQ409';
  end if;

  for v_item in select * from jsonb_array_elements(p_evidence) loop
    insert into public.mastery_evidence (user_id, attempt_id, skill_id, dimension, outcome, independence, model_version)
      values (p_user_id, p_attempt_id, v_item ->> 'skill_id', (v_item ->> 'dimension')::public.skill_dimension,
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
end;
$$;

revoke all on function public.record_followup_answers(uuid, uuid, jsonb, jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.record_followup_answers(uuid, uuid, jsonb, jsonb, jsonb) to service_role;

-- ---------------------------------------------------------------------------------------------
-- Data portability: follow-up answers travel with their attempts. The base functions keep every
-- other table; these wrappers add followup_answers (grading-derived, so imported only with
-- verified progress, and only onto the learner's own attempts). delete_user_data needs no change:
-- deleting attempts cascades to their answers.
-- ---------------------------------------------------------------------------------------------

alter function public.export_user_data(uuid) rename to export_user_data_base;
alter function public.import_user_data(uuid, jsonb, boolean) rename to import_user_data_base;

create function public.export_user_data(p_user_id uuid) returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select public.export_user_data_base(p_user_id) || jsonb_build_object(
    'followup_answers', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', f.id, 'attempt_id', f.attempt_id, 'followup_id', f.followup_id, 'choice', f.choice, 'correct', f.correct,
        'created_at', f.created_at) order by f.created_at, f.id)
      from public.followup_answers f where f.user_id = p_user_id), '[]'::jsonb));
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
  v_report := public.import_user_data_base(p_user_id, p_data, p_include_progress);
  if not p_include_progress then
    return v_report;
  end if;

  select count(*) into v_total from jsonb_array_elements(coalesce(p_data -> 'followup_answers', '[]'));
  with inserted as (
    insert into public.followup_answers (id, user_id, attempt_id, followup_id, choice, correct, created_at)
      select x.id, p_user_id, x.attempt_id, x.followup_id, x.choice, x.correct, x.created_at
      from jsonb_to_recordset(coalesce(p_data -> 'followup_answers', '[]'))
        as x(id uuid, attempt_id uuid, followup_id text, choice smallint, correct boolean, created_at timestamptz)
      where exists (select 1 from public.attempts a where a.id = x.attempt_id and a.user_id = p_user_id)
      on conflict do nothing
      returning 1)
  select count(*) into v_done from inserted;
  return v_report || jsonb_build_object('followup_answers', jsonb_build_object('imported', v_done, 'skipped', v_total - v_done));
end;
$$;

revoke all on function public.export_user_data_base(uuid) from public, anon, authenticated;
revoke all on function public.import_user_data_base(uuid, jsonb, boolean) from public, anon, authenticated;
revoke all on function public.export_user_data(uuid) from public, anon, authenticated;
revoke all on function public.import_user_data(uuid, jsonb, boolean) from public, anon, authenticated;
grant execute on function public.export_user_data(uuid) to service_role;
grant execute on function public.import_user_data(uuid, jsonb, boolean) to service_role;
