-- Data portability (spec §47, §61, §63, §64, §67, §68): export a learner's records as one JSON document,
-- import an archive back, and delete a learner's progress and projects.
--
-- All three run with the server (secret) key only. The server authenticates the learner and
-- passes their id; these functions never trust ids from inside an archive to identify an owner.
-- Archive authenticity (HMAC signature) is checked in TypeScript (lib/archive) before
-- import_user_data is called with p_include_progress = true.

-- ---------------------------------------------------------------------------------------------
-- Export: one consistent snapshot (a single statement) of everything the learner owns.
-- Content is referenced by (content_id, version), not by database uuid, so an archive can be
-- restored into a different project that synced the same content.
-- ---------------------------------------------------------------------------------------------

create function public.export_user_data(p_user_id uuid) returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'profile', (
      select jsonb_build_object('timezone', p.timezone, 'target_role', p.target_role, 'settings', p.settings)
      from public.profiles p where p.user_id = p_user_id),
    'sessions', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', s.id, 'budget_minutes', s.budget_minutes, 'state', s.state, 'client_request_key', s.client_request_key,
        'policy_version', s.policy_version, 'started_at', s.started_at, 'completed_at', s.completed_at) order by s.started_at, s.id)
      from public.sessions s where s.user_id = p_user_id), '[]'::jsonb),
    'session_items', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', i.id, 'session_id', i.session_id, 'content_id', v.content_id, 'content_version', v.version,
        'ordinal', i.ordinal, 'state', i.state, 'estimated_minutes', i.estimated_minutes) order by i.session_id, i.ordinal)
      from public.session_items i
      join public.sessions s on s.id = i.session_id
      join public.content_versions v on v.id = i.content_version_id
      where s.user_id = p_user_id), '[]'::jsonb),
    'attempts', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', a.id, 'session_item_id', a.session_item_id, 'content_id', v.content_id, 'content_version', v.version,
        'response', a.response, 'hint_level', a.hint_level, 'active_seconds', a.active_seconds, 'state', a.state,
        'outcome', a.outcome, 'rubric_version', a.rubric_version, 'created_at', a.created_at, 'graded_at', a.graded_at)
        order by a.created_at, a.id)
      from public.attempts a join public.content_versions v on v.id = a.content_version_id
      where a.user_id = p_user_id), '[]'::jsonb),
    'mastery_evidence', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', e.id, 'attempt_id', e.attempt_id, 'skill_id', e.skill_id, 'dimension', e.dimension, 'outcome', e.outcome,
        'independence', e.independence, 'model_version', e.model_version, 'created_at', e.created_at) order by e.created_at, e.id)
      from public.mastery_evidence e where e.user_id = p_user_id), '[]'::jsonb),
    'skill_states', coalesce((
      select jsonb_agg(jsonb_build_object(
        'skill_id', k.skill_id, 'dimension', k.dimension, 'estimate', k.estimate, 'evidence_count', k.evidence_count,
        'review_due_at', k.review_due_at, 'scheduler_version', k.scheduler_version, 'model_version', k.model_version,
        'updated_at', k.updated_at) order by k.skill_id, k.dimension)
      from public.user_skill_state k where k.user_id = p_user_id), '[]'::jsonb),
    'recommendations', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', r.id, 'session_id', r.session_id, 'reason_codes', r.reason_codes, 'evidence_ids', r.evidence_ids,
        'policy_version', r.policy_version, 'created_at', r.created_at) order by r.created_at, r.id)
      from public.recommendations r where r.user_id = p_user_id), '[]'::jsonb),
    'xp_events', coalesce((
      select jsonb_agg(jsonb_build_object('event_key', x.event_key, 'delta', x.delta, 'created_at', x.created_at)
        order by x.created_at, x.event_key)
      from public.xp_ledger x where x.user_id = p_user_id), '[]'::jsonb),
    'achievements', coalesce((
      select jsonb_agg(jsonb_build_object('achievement_id', w.achievement_id, 'awarded_at', w.awarded_at) order by w.awarded_at)
      from public.achievement_awards w where w.user_id = p_user_id), '[]'::jsonb),
    'hint_requests', coalesce((
      select jsonb_agg(jsonb_build_object(
        'content_id', v.content_id, 'content_version', v.version, 'tier', h.tier, 'requested_at', h.requested_at)
        order by h.requested_at, v.content_id, h.tier)
      from public.hint_requests h join public.content_versions v on v.id = h.content_version_id
      where h.user_id = p_user_id), '[]'::jsonb),
    'projects', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', p.id, 'content_id', p.content_id, 'campaign_id', p.campaign_id, 'title', p.title,
        'created_at', p.created_at, 'updated_at', p.updated_at) order by p.created_at, p.id)
      from public.projects p where p.user_id = p_user_id), '[]'::jsonb),
    'project_files', coalesce((
      select jsonb_agg(jsonb_build_object(
        'project_id', f.project_id, 'path', f.path, 'revision', f.revision, 'source', f.source, 'updated_at', f.updated_at)
        order by f.project_id, f.path)
      from public.project_files f where f.user_id = p_user_id), '[]'::jsonb),
    'project_checkpoints', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', c.id, 'project_id', c.project_id, 'files', c.files, 'label', c.label, 'created_at', c.created_at)
        order by c.created_at, c.id)
      from public.project_checkpoints c where c.user_id = p_user_id), '[]'::jsonb),
    'notes', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', n.id, 'content_id', n.content_id, 'body', n.body, 'created_at', n.created_at, 'updated_at', n.updated_at)
        order by n.created_at, n.id)
      from public.notes n where n.user_id = p_user_id), '[]'::jsonb),
    'reflections', coalesce((
      select jsonb_agg(jsonb_build_object('id', r.id, 'attempt_id', r.attempt_id, 'body', r.body, 'created_at', r.created_at)
        order by r.created_at, r.id)
      from public.reflections r where r.user_id = p_user_id), '[]'::jsonb),
    'recommendation_feedback', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', f.id, 'recommendation_id', f.recommendation_id, 'feedback', f.feedback, 'note', f.note, 'created_at', f.created_at)
        order by f.created_at, f.id)
      from public.recommendation_feedback f where f.user_id = p_user_id), '[]'::jsonb)
  );
$$;

-- ---------------------------------------------------------------------------------------------
-- Import: merge an archive into the learner's records in one transaction.
--
-- The caller has already validated every row's shape and remapped ids (lib/archive/remap.ts),
-- so re-importing the same archive is a no-op: every insert is "on conflict do nothing" and
-- existing data always wins. Child rows are inserted only when their parent belongs to
-- p_user_id, so an archive naming someone else's ids can never attach rows to their records.
--
-- Learner-authored data (profile preferences, projects, files, checkpoints, notes) is always
-- imported. Grading-derived data (sessions, attempts, evidence, skill state, recommendations, XP,
-- achievements, hints, reflections, feedback) only when p_include_progress — i.e. the server
-- verified its own signature on the archive.
--
-- Raises CQ422 listing content, skills or rubrics the archive needs but this database lacks.
-- Returns {table: {"imported": n, "skipped": m}}.
-- ---------------------------------------------------------------------------------------------

create function public.import_user_data(p_user_id uuid, p_data jsonb, p_include_progress boolean) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_missing text[];
  v_content_versions jsonb;
  v_project_targets jsonb;
  v_report jsonb := '{}'::jsonb;
  v_total integer;
  v_done integer;
begin
  if not exists (select 1 from public.profiles where user_id = p_user_id) then
    raise exception 'profile not found' using errcode = 'P0002';
  end if;

  -- Content references ("content_id@version") resolved to this database's version ids.
  select coalesce(jsonb_object_agg(r.content_id || '@' || r.content_version, v.id), '{}'::jsonb) into v_content_versions
  from (
    select distinct x.content_id, x.content_version from jsonb_to_recordset(
      case when p_include_progress then
        coalesce(p_data -> 'session_items', '[]') || coalesce(p_data -> 'attempts', '[]') || coalesce(p_data -> 'hint_requests', '[]')
      else '[]'::jsonb end) as x(content_id text, content_version integer)
  ) r
  join public.content_versions v on v.content_id = r.content_id and v.version = r.content_version;

  select array_agg(distinct m) into v_missing from (
    select 'content ' || x.content_id || '@v' || x.content_version as m from jsonb_to_recordset(
        case when p_include_progress then
          coalesce(p_data -> 'session_items', '[]') || coalesce(p_data -> 'attempts', '[]') || coalesce(p_data -> 'hint_requests', '[]')
        else '[]'::jsonb end) as x(content_id text, content_version integer)
      where not v_content_versions ? (x.content_id || '@' || x.content_version)
    union all
    select 'content ' || x.content_id from jsonb_to_recordset(
        coalesce(p_data -> 'projects', '[]') || coalesce(p_data -> 'notes', '[]')) as x(content_id text)
      where x.content_id is not null and not exists (select 1 from public.content_items c where c.id = x.content_id)
    union all
    select 'skill ' || x.skill_id from jsonb_to_recordset(
        case when p_include_progress then coalesce(p_data -> 'mastery_evidence', '[]') || coalesce(p_data -> 'skill_states', '[]')
        else '[]'::jsonb end) as x(skill_id text)
      where not exists (select 1 from public.skills s where s.id = x.skill_id)
    union all
    select 'rubric ' || x.rubric_version from jsonb_to_recordset(
        case when p_include_progress then coalesce(p_data -> 'attempts', '[]') else '[]'::jsonb end) as x(rubric_version text)
      where x.rubric_version is not null and not exists (select 1 from public.rubric_versions r where r.id = x.rubric_version)
  ) missing;
  if v_missing is not null then
    raise exception 'archive references records this database does not have: %', array_to_string(v_missing, ', ')
      using errcode = 'CQ422', detail = array_to_string(v_missing, ', ');
  end if;

  -- Preferences: keys already set in this account win over the archive's.
  update public.profiles p
    set settings = coalesce(p_data #> '{profile,settings}', '{}'::jsonb) || p.settings
    where p.user_id = p_user_id and jsonb_typeof(p_data #> '{profile,settings}') = 'object';

  -- Projects. A campaign project the learner already has here absorbs the archive's files
  -- (one project per campaign), so the archive's project id is mapped onto the existing one.
  select coalesce(jsonb_object_agg(x.id, coalesce(existing.id, x.id)), '{}'::jsonb) into v_project_targets
  from jsonb_to_recordset(coalesce(p_data -> 'projects', '[]')) as x(id uuid, campaign_id text)
  left join public.projects existing
    on existing.user_id = p_user_id and existing.campaign_id = x.campaign_id and existing.id <> x.id;

  select count(*) into v_total from jsonb_array_elements(coalesce(p_data -> 'projects', '[]'));
  with inserted as (
    insert into public.projects (id, user_id, content_id, campaign_id, title, created_at, updated_at)
      select x.id, p_user_id, x.content_id, x.campaign_id, x.title, x.created_at, x.updated_at
      from jsonb_to_recordset(coalesce(p_data -> 'projects', '[]'))
        as x(id uuid, content_id text, campaign_id text, title text, created_at timestamptz, updated_at timestamptz)
      where (v_project_targets ->> x.id::text)::uuid = x.id
      on conflict do nothing
      returning 1)
  select count(*) into v_done from inserted;
  v_report := v_report || jsonb_build_object('projects', jsonb_build_object('imported', v_done, 'skipped', v_total - v_done));

  -- Files: a path that already exists keeps its current source. A new file gets a fresh
  -- mutation id and revision 1 so the editor's revision checks start clean.
  select count(*) into v_total from jsonb_array_elements(coalesce(p_data -> 'project_files', '[]'));
  with inserted as (
    insert into public.project_files (project_id, user_id, path, revision, source, last_mutation_id, updated_at)
      select m.target_id, p_user_id, x.path, 1, x.source, gen_random_uuid(), x.updated_at
      from jsonb_to_recordset(coalesce(p_data -> 'project_files', '[]'))
        as x(project_id uuid, path text, source text, updated_at timestamptz)
      cross join lateral (select (v_project_targets ->> x.project_id::text)::uuid as target_id) m
      where exists (select 1 from public.projects p where p.id = m.target_id and p.user_id = p_user_id)
      on conflict do nothing
      returning 1)
  select count(*) into v_done from inserted;
  v_report := v_report || jsonb_build_object('project_files', jsonb_build_object('imported', v_done, 'skipped', v_total - v_done));

  select count(*) into v_total from jsonb_array_elements(coalesce(p_data -> 'project_checkpoints', '[]'));
  with inserted as (
    insert into public.project_checkpoints (id, project_id, user_id, files, label, created_at)
      select x.id, m.target_id, p_user_id, x.files, x.label, x.created_at
      from jsonb_to_recordset(coalesce(p_data -> 'project_checkpoints', '[]'))
        as x(id uuid, project_id uuid, files jsonb, label text, created_at timestamptz)
      cross join lateral (select (v_project_targets ->> x.project_id::text)::uuid as target_id) m
      where exists (select 1 from public.projects p where p.id = m.target_id and p.user_id = p_user_id)
      on conflict do nothing
      returning 1)
  select count(*) into v_done from inserted;
  v_report := v_report || jsonb_build_object('project_checkpoints', jsonb_build_object('imported', v_done, 'skipped', v_total - v_done));

  select count(*) into v_total from jsonb_array_elements(coalesce(p_data -> 'notes', '[]'));
  with inserted as (
    insert into public.notes (id, user_id, content_id, body, created_at, updated_at)
      select x.id, p_user_id, x.content_id, x.body, x.created_at, x.updated_at
      from jsonb_to_recordset(coalesce(p_data -> 'notes', '[]'))
        as x(id uuid, content_id text, body text, created_at timestamptz, updated_at timestamptz)
      on conflict do nothing
      returning 1)
  select count(*) into v_done from inserted;
  v_report := v_report || jsonb_build_object('notes', jsonb_build_object('imported', v_done, 'skipped', v_total - v_done));

  if not p_include_progress then
    return v_report;
  end if;

  select count(*) into v_total from jsonb_array_elements(coalesce(p_data -> 'sessions', '[]'));
  with inserted as (
    insert into public.sessions (id, user_id, budget_minutes, state, client_request_key, policy_version, started_at, completed_at)
      select x.id, p_user_id, x.budget_minutes, x.state, x.client_request_key, x.policy_version, x.started_at, x.completed_at
      from jsonb_to_recordset(coalesce(p_data -> 'sessions', '[]'))
        as x(id uuid, budget_minutes smallint, state public.session_state, client_request_key text, policy_version text,
             started_at timestamptz, completed_at timestamptz)
      on conflict do nothing
      returning 1)
  select count(*) into v_done from inserted;
  v_report := v_report || jsonb_build_object('sessions', jsonb_build_object('imported', v_done, 'skipped', v_total - v_done));

  select count(*) into v_total from jsonb_array_elements(coalesce(p_data -> 'session_items', '[]'));
  with inserted as (
    insert into public.session_items (id, session_id, content_version_id, ordinal, state, estimated_minutes)
      select x.id, x.session_id, c.version_id, x.ordinal, x.state, x.estimated_minutes
      from jsonb_to_recordset(coalesce(p_data -> 'session_items', '[]'))
        as x(id uuid, session_id uuid, content_id text, content_version integer, ordinal smallint,
             state public.session_item_state, estimated_minutes smallint)
      cross join lateral (select (v_content_versions ->> (x.content_id || '@' || x.content_version))::uuid as version_id) c
      where exists (select 1 from public.sessions s where s.id = x.session_id and s.user_id = p_user_id)
      on conflict do nothing
      returning 1)
  select count(*) into v_done from inserted;
  v_report := v_report || jsonb_build_object('session_items', jsonb_build_object('imported', v_done, 'skipped', v_total - v_done));

  -- An attempt keeps its session item only if that item is (now) the learner's.
  select count(*) into v_total from jsonb_array_elements(coalesce(p_data -> 'attempts', '[]'));
  with inserted as (
    insert into public.attempts (id, user_id, session_item_id, content_version_id, response, hint_level, active_seconds,
                                 state, outcome, rubric_version, created_at, graded_at)
      select x.id, p_user_id,
             case when exists (select 1 from public.session_items i join public.sessions s on s.id = i.session_id
                               where i.id = x.session_item_id and s.user_id = p_user_id) then x.session_item_id end,
             c.version_id, x.response, x.hint_level, x.active_seconds, x.state, x.outcome, x.rubric_version,
             x.created_at, x.graded_at
      from jsonb_to_recordset(coalesce(p_data -> 'attempts', '[]'))
        as x(id uuid, session_item_id uuid, content_id text, content_version integer, response jsonb, hint_level smallint,
             active_seconds integer, state public.attempt_state, outcome text, rubric_version text,
             created_at timestamptz, graded_at timestamptz)
      cross join lateral (select (v_content_versions ->> (x.content_id || '@' || x.content_version))::uuid as version_id) c
      on conflict do nothing
      returning 1)
  select count(*) into v_done from inserted;
  v_report := v_report || jsonb_build_object('attempts', jsonb_build_object('imported', v_done, 'skipped', v_total - v_done));

  select count(*) into v_total from jsonb_array_elements(coalesce(p_data -> 'mastery_evidence', '[]'));
  with inserted as (
    insert into public.mastery_evidence (id, user_id, attempt_id, skill_id, dimension, outcome, independence, model_version, created_at)
      select x.id, p_user_id, x.attempt_id, x.skill_id, x.dimension, x.outcome, x.independence, x.model_version, x.created_at
      from jsonb_to_recordset(coalesce(p_data -> 'mastery_evidence', '[]'))
        as x(id uuid, attempt_id uuid, skill_id text, dimension public.skill_dimension, outcome public.evidence_outcome,
             independence public.independence, model_version text, created_at timestamptz)
      where exists (select 1 from public.attempts a where a.id = x.attempt_id and a.user_id = p_user_id)
      on conflict do nothing
      returning 1)
  select count(*) into v_done from inserted;
  v_report := v_report || jsonb_build_object('mastery_evidence', jsonb_build_object('imported', v_done, 'skipped', v_total - v_done));

  -- Skill state: the more recently updated estimate wins.
  select count(*) into v_total from jsonb_array_elements(coalesce(p_data -> 'skill_states', '[]'));
  with written as (
    insert into public.user_skill_state (user_id, skill_id, dimension, estimate, evidence_count, review_due_at,
                                         scheduler_version, model_version, updated_at)
      select p_user_id, x.skill_id, x.dimension, x.estimate, x.evidence_count, x.review_due_at,
             x.scheduler_version, x.model_version, x.updated_at
      from jsonb_to_recordset(coalesce(p_data -> 'skill_states', '[]'))
        as x(skill_id text, dimension public.skill_dimension, estimate numeric, evidence_count integer,
             review_due_at timestamptz, scheduler_version text, model_version text, updated_at timestamptz)
      on conflict (user_id, skill_id, dimension) do update set
        estimate = excluded.estimate, evidence_count = excluded.evidence_count, review_due_at = excluded.review_due_at,
        scheduler_version = excluded.scheduler_version, model_version = excluded.model_version, updated_at = excluded.updated_at
        where excluded.updated_at > public.user_skill_state.updated_at
      returning 1)
  select count(*) into v_done from written;
  v_report := v_report || jsonb_build_object('skill_states', jsonb_build_object('imported', v_done, 'skipped', v_total - v_done));

  select count(*) into v_total from jsonb_array_elements(coalesce(p_data -> 'recommendations', '[]'));
  with inserted as (
    insert into public.recommendations (id, user_id, session_id, reason_codes, evidence_ids, policy_version, created_at)
      select x.id, p_user_id,
             case when exists (select 1 from public.sessions s where s.id = x.session_id and s.user_id = p_user_id) then x.session_id end,
             x.reason_codes, x.evidence_ids, x.policy_version, x.created_at
      from jsonb_to_recordset(coalesce(p_data -> 'recommendations', '[]'))
        as x(id uuid, session_id uuid, reason_codes text[], evidence_ids uuid[], policy_version text, created_at timestamptz)
      on conflict do nothing
      returning 1)
  select count(*) into v_done from inserted;
  v_report := v_report || jsonb_build_object('recommendations', jsonb_build_object('imported', v_done, 'skipped', v_total - v_done));

  -- XP is keyed by business event, so an event already earned here is never awarded twice.
  select count(*) into v_total from jsonb_array_elements(coalesce(p_data -> 'xp_events', '[]'));
  with inserted as (
    insert into public.xp_ledger (user_id, event_key, delta, created_at)
      select p_user_id, x.event_key, x.delta, x.created_at
      from jsonb_to_recordset(coalesce(p_data -> 'xp_events', '[]')) as x(event_key text, delta integer, created_at timestamptz)
      on conflict do nothing
      returning 1)
  select count(*) into v_done from inserted;
  v_report := v_report || jsonb_build_object('xp_events', jsonb_build_object('imported', v_done, 'skipped', v_total - v_done));

  select count(*) into v_total from jsonb_array_elements(coalesce(p_data -> 'achievements', '[]'));
  with inserted as (
    insert into public.achievement_awards (user_id, achievement_id, awarded_at)
      select p_user_id, x.achievement_id, x.awarded_at
      from jsonb_to_recordset(coalesce(p_data -> 'achievements', '[]')) as x(achievement_id text, awarded_at timestamptz)
      on conflict do nothing
      returning 1)
  select count(*) into v_done from inserted;
  v_report := v_report || jsonb_build_object('achievements', jsonb_build_object('imported', v_done, 'skipped', v_total - v_done));

  select count(*) into v_total from jsonb_array_elements(coalesce(p_data -> 'hint_requests', '[]'));
  with inserted as (
    insert into public.hint_requests (user_id, content_version_id, tier, requested_at)
      select p_user_id, c.version_id, x.tier, x.requested_at
      from jsonb_to_recordset(coalesce(p_data -> 'hint_requests', '[]'))
        as x(content_id text, content_version integer, tier smallint, requested_at timestamptz)
      cross join lateral (select (v_content_versions ->> (x.content_id || '@' || x.content_version))::uuid as version_id) c
      on conflict do nothing
      returning 1)
  select count(*) into v_done from inserted;
  v_report := v_report || jsonb_build_object('hint_requests', jsonb_build_object('imported', v_done, 'skipped', v_total - v_done));

  select count(*) into v_total from jsonb_array_elements(coalesce(p_data -> 'reflections', '[]'));
  with inserted as (
    insert into public.reflections (id, user_id, attempt_id, body, created_at)
      select x.id, p_user_id, x.attempt_id, x.body, x.created_at
      from jsonb_to_recordset(coalesce(p_data -> 'reflections', '[]')) as x(id uuid, attempt_id uuid, body jsonb, created_at timestamptz)
      where exists (select 1 from public.attempts a where a.id = x.attempt_id and a.user_id = p_user_id)
      on conflict do nothing
      returning 1)
  select count(*) into v_done from inserted;
  v_report := v_report || jsonb_build_object('reflections', jsonb_build_object('imported', v_done, 'skipped', v_total - v_done));

  select count(*) into v_total from jsonb_array_elements(coalesce(p_data -> 'recommendation_feedback', '[]'));
  with inserted as (
    insert into public.recommendation_feedback (id, recommendation_id, user_id, feedback, note, created_at)
      select x.id, x.recommendation_id, p_user_id, x.feedback, x.note, x.created_at
      from jsonb_to_recordset(coalesce(p_data -> 'recommendation_feedback', '[]'))
        as x(id uuid, recommendation_id uuid, feedback public.recommendation_feedback_kind, note text, created_at timestamptz)
      where exists (select 1 from public.recommendations r where r.id = x.recommendation_id and r.user_id = p_user_id)
      on conflict do nothing
      returning 1)
  select count(*) into v_done from inserted;
  v_report := v_report || jsonb_build_object('recommendation_feedback', jsonb_build_object('imported', v_done, 'skipped', v_total - v_done));

  return v_report;
end;
$$;

-- ---------------------------------------------------------------------------------------------
-- Delete: the learner's progress, projects and personal records, in one transaction. The
-- account and profile stay (sign-in still works). Execution jobs stay for quota accounting, but
-- their learner-visible output is erased.
-- ---------------------------------------------------------------------------------------------

create function public.delete_user_data(p_user_id uuid) returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (select 1 from public.profiles where user_id = p_user_id) then
    raise exception 'profile not found' using errcode = 'P0002';
  end if;
  delete from public.recommendation_feedback where user_id = p_user_id;
  delete from public.reflections where user_id = p_user_id;
  delete from public.recommendations where user_id = p_user_id;
  delete from public.mastery_evidence where user_id = p_user_id;
  delete from public.attempts where user_id = p_user_id;
  delete from public.sessions where user_id = p_user_id; -- cascades to session_items
  delete from public.user_skill_state where user_id = p_user_id;
  delete from public.xp_ledger where user_id = p_user_id;
  delete from public.achievement_awards where user_id = p_user_id;
  delete from public.hint_requests where user_id = p_user_id;
  delete from public.notes where user_id = p_user_id;
  delete from public.projects where user_id = p_user_id; -- cascades to files and checkpoints
  delete from public.sync_mutations where user_id = p_user_id;
  update public.execution_jobs set limited_logs = null, result = null where user_id = p_user_id;
end;
$$;

revoke all on function public.export_user_data(uuid) from public, anon, authenticated;
revoke all on function public.import_user_data(uuid, jsonb, boolean) from public, anon, authenticated;
revoke all on function public.delete_user_data(uuid) from public, anon, authenticated;
grant execute on function public.export_user_data(uuid) to service_role;
grant execute on function public.import_user_data(uuid, jsonb, boolean) to service_role;
grant execute on function public.delete_user_data(uuid) to service_role;
