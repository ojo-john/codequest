-- CodeQuest schema, part 2: sessions, attempts, evidence, projects and personal data
-- (spec §21–22, §36, §42, §51, §56, §61, §66, §71).
--
-- Two classes of user data:
--   * Learner-authored (project files, notes, reflections, recommendation feedback): the owner
--     reads and writes their own rows.
--   * Grading-derived (attempts, mastery evidence, skill state, XP, achievements,
--     recommendations): the owner may only READ. Writes happen in trusted server transactions
--     (service role), so a learner can never award themselves outcomes, mastery or XP (spec §66).

create type public.session_state as enum ('active', 'completed', 'abandoned');
create type public.session_item_state as enum ('pending', 'in_progress', 'completed', 'skipped');
create type public.attempt_state as enum ('submitted', 'graded', 'infrastructure_error');
create type public.evidence_outcome as enum ('pass', 'partial', 'fail');
-- How independent the evidence is (spec §15, §70): hints and revealed solutions are tracked,
-- never penalised with XP, and reserve mastery credit for later unassisted work.
create type public.independence as enum ('independent', 'hinted', 'solution_revealed', 'accessibility_supported');
create type public.recommendation_feedback_kind as enum ('accepted', 'dismissed', 'corrected');

-- ---------------------------------------------------------------------------------------------
-- Sessions (spec §5, §67)
-- ---------------------------------------------------------------------------------------------

create table public.sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (user_id) on delete cascade,
  budget_minutes smallint not null check (budget_minutes in (5, 15, 30, 45, 60, 90)),
  state public.session_state not null default 'active',
  -- POST /api/sessions idempotency: one session per client request key.
  client_request_key text not null check (char_length(client_request_key) between 8 and 100),
  policy_version text not null,
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  unique (user_id, client_request_key),
  check ((state = 'completed') = (completed_at is not null))
);

create index sessions_user_started_idx on public.sessions (user_id, started_at desc);

create table public.session_items (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.sessions (id) on delete cascade,
  content_version_id uuid not null references public.content_versions (id) on delete restrict,
  ordinal smallint not null check (ordinal >= 0),
  state public.session_item_state not null default 'pending',
  estimated_minutes smallint not null check (estimated_minutes between 1 and 90),
  unique (session_id, ordinal)
);

-- ---------------------------------------------------------------------------------------------
-- Attempts and evidence (server-written)
-- ---------------------------------------------------------------------------------------------

create table public.attempts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (user_id) on delete cascade,
  session_item_id uuid references public.session_items (id) on delete set null,
  content_version_id uuid not null references public.content_versions (id) on delete restrict,
  response jsonb not null,
  hint_level smallint not null default 0 check (hint_level between 0 and 5),
  -- Active time only; idle time and infrastructure failures are excluded (spec §61).
  active_seconds integer not null default 0 check (active_seconds >= 0),
  state public.attempt_state not null default 'submitted',
  outcome text,
  rubric_version text references public.rubric_versions (id),
  created_at timestamptz not null default now(),
  graded_at timestamptz,
  check ((state = 'graded') = (graded_at is not null))
);

create index attempts_user_created_idx on public.attempts (user_id, created_at desc);
create index attempts_content_idx on public.attempts (user_id, content_version_id);

create table public.mastery_evidence (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (user_id) on delete cascade,
  attempt_id uuid not null references public.attempts (id) on delete cascade,
  skill_id text not null references public.skills (id) on delete restrict,
  dimension public.skill_dimension not null,
  outcome public.evidence_outcome not null,
  independence public.independence not null,
  model_version text not null,
  created_at timestamptz not null default now(),
  -- Reprocessing an attempt must not duplicate evidence.
  unique (attempt_id, skill_id, dimension)
);

create index mastery_evidence_user_skill_idx on public.mastery_evidence (user_id, skill_id, dimension, created_at desc);

create table public.user_skill_state (
  user_id uuid not null references public.profiles (user_id) on delete cascade,
  skill_id text not null references public.skills (id) on delete restrict,
  dimension public.skill_dimension not null,
  -- A learning estimate, not a calibrated probability (spec §21).
  estimate numeric(4, 3) not null check (estimate between 0 and 1),
  evidence_count integer not null default 0 check (evidence_count >= 0),
  review_due_at timestamptz,
  scheduler_version text not null,
  model_version text not null,
  updated_at timestamptz not null default now(),
  primary key (user_id, skill_id, dimension)
);

create index user_skill_state_due_idx on public.user_skill_state (user_id, review_due_at);

create table public.recommendations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (user_id) on delete cascade,
  session_id uuid references public.sessions (id) on delete set null,
  reason_codes text[] not null check (cardinality(reason_codes) > 0),
  evidence_ids uuid[] not null default '{}',
  policy_version text not null,
  created_at timestamptz not null default now()
);

create index recommendations_user_idx on public.recommendations (user_id, created_at desc);

-- XP is a ledger keyed by a business event so retries and reprocessing never double-award
-- (spec §36, §66). XP is kept separate from readiness.
create table public.xp_ledger (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (user_id) on delete cascade,
  event_key text not null check (char_length(event_key) between 1 and 200),
  delta integer not null check (delta between 0 and 1000),
  created_at timestamptz not null default now(),
  unique (user_id, event_key)
);

create table public.achievement_awards (
  user_id uuid not null references public.profiles (user_id) on delete cascade,
  achievement_id text not null,
  awarded_at timestamptz not null default now(),
  primary key (user_id, achievement_id)
);

create table public.model_configs (
  id uuid primary key default gen_random_uuid(),
  version text not null unique,
  parameters jsonb not null,
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------------------------
-- Learner-authored data
-- ---------------------------------------------------------------------------------------------

create table public.projects (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (user_id) on delete cascade,
  content_id text references public.content_items (id) on delete restrict,
  title text not null check (char_length(title) between 1 and 120),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index projects_user_idx on public.projects (user_id, updated_at desc);

-- Current source per file. Writes go through save_project_file() so revisions conflict
-- explicitly instead of silently overwriting competing edits (spec §48, §71).
create table public.project_files (
  project_id uuid not null references public.projects (id) on delete cascade,
  user_id uuid not null references public.profiles (user_id) on delete cascade,
  -- Same rules as lib/execution/source-files.ts, so every saved file can be executed.
  path text not null check (char_length(path) <= 200 and path ~ '^([A-Za-z_][A-Za-z0-9_-]*/)*[A-Za-z_][A-Za-z0-9_]*\.java$'),
  revision integer not null check (revision >= 1),
  source text not null check (octet_length(source) <= 204800),
  last_mutation_id uuid not null,
  updated_at timestamptz not null default now(),
  primary key (project_id, path)
);

-- Immutable snapshots; a submission references one (spec §62: store attempt snapshots).
create table public.project_checkpoints (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects (id) on delete cascade,
  user_id uuid not null references public.profiles (user_id) on delete cascade,
  files jsonb not null check (jsonb_typeof(files) = 'object'),
  label text check (char_length(label) <= 120),
  created_at timestamptz not null default now()
);

create index project_checkpoints_project_idx on public.project_checkpoints (project_id, created_at desc);

-- Applied offline-sync mutations, so a replayed outbox write is a no-op (spec §71).
create table public.sync_mutations (
  id uuid primary key,
  user_id uuid not null references public.profiles (user_id) on delete cascade,
  applied_at timestamptz not null default now()
);

create table public.notes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (user_id) on delete cascade,
  content_id text not null references public.content_items (id) on delete restrict,
  -- The learner's own words; never treated as canonical fact (spec §51).
  body text not null check (char_length(body) between 1 and 20000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index notes_user_content_idx on public.notes (user_id, content_id);

create table public.reflections (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (user_id) on delete cascade,
  attempt_id uuid not null references public.attempts (id) on delete cascade,
  body jsonb not null check (jsonb_typeof(body) = 'object'),
  created_at timestamptz not null default now()
);

create index reflections_user_idx on public.reflections (user_id, created_at desc);

create table public.recommendation_feedback (
  id uuid primary key default gen_random_uuid(),
  recommendation_id uuid not null references public.recommendations (id) on delete cascade,
  user_id uuid not null references public.profiles (user_id) on delete cascade,
  feedback public.recommendation_feedback_kind not null,
  note text check (char_length(note) <= 2000),
  created_at timestamptz not null default now(),
  unique (recommendation_id, user_id)
);

create trigger projects_touch before update on public.projects for each row execute function public.touch_updated_at();
create trigger notes_touch before update on public.notes for each row execute function public.touch_updated_at();

-- ---------------------------------------------------------------------------------------------
-- Row-level security
-- ---------------------------------------------------------------------------------------------

alter table public.sessions enable row level security;
alter table public.session_items enable row level security;
alter table public.attempts enable row level security;
alter table public.mastery_evidence enable row level security;
alter table public.user_skill_state enable row level security;
alter table public.recommendations enable row level security;
alter table public.xp_ledger enable row level security;
alter table public.achievement_awards enable row level security;
alter table public.model_configs enable row level security;
alter table public.projects enable row level security;
alter table public.project_files enable row level security;
alter table public.project_checkpoints enable row level security;
alter table public.sync_mutations enable row level security;
alter table public.notes enable row level security;
alter table public.reflections enable row level security;
alter table public.recommendation_feedback enable row level security;

-- Start from nothing: Supabase's default privileges grant everything to anon/authenticated.
revoke all on public.sessions, public.session_items, public.attempts, public.mastery_evidence,
  public.user_skill_state, public.recommendations, public.xp_ledger, public.achievement_awards,
  public.model_configs, public.projects, public.project_files, public.project_checkpoints,
  public.sync_mutations, public.notes, public.reflections, public.recommendation_feedback
  from anon, authenticated;

-- Grading-derived: owner reads, nobody writes through the API.
create policy "sessions: owner reads" on public.sessions for select to authenticated using ((select auth.uid()) = user_id);
create policy "session_items: owner reads" on public.session_items for select to authenticated using (
  exists (select 1 from public.sessions s where s.id = session_id and s.user_id = (select auth.uid()))
);
create policy "attempts: owner reads" on public.attempts for select to authenticated using ((select auth.uid()) = user_id);
create policy "mastery_evidence: owner reads" on public.mastery_evidence for select to authenticated using ((select auth.uid()) = user_id);
create policy "user_skill_state: owner reads" on public.user_skill_state for select to authenticated using ((select auth.uid()) = user_id);
create policy "recommendations: owner reads" on public.recommendations for select to authenticated using ((select auth.uid()) = user_id);
create policy "xp_ledger: owner reads" on public.xp_ledger for select to authenticated using ((select auth.uid()) = user_id);
create policy "achievement_awards: owner reads" on public.achievement_awards for select to authenticated using ((select auth.uid()) = user_id);
create policy "project_checkpoints: owner reads" on public.project_checkpoints for select to authenticated using ((select auth.uid()) = user_id);

grant select on public.sessions, public.session_items, public.attempts, public.mastery_evidence,
  public.user_skill_state, public.recommendations, public.xp_ledger, public.achievement_awards,
  public.project_checkpoints
  to authenticated;
-- model_configs and sync_mutations: no API access at all (server only).

-- Learner-authored: owner reads and writes; user_id is pinned to auth.uid() on write.
create policy "projects: owner reads" on public.projects for select to authenticated using ((select auth.uid()) = user_id);
create policy "projects: owner inserts" on public.projects for insert to authenticated with check ((select auth.uid()) = user_id);
create policy "projects: owner updates" on public.projects for update to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "projects: owner deletes" on public.projects for delete to authenticated using ((select auth.uid()) = user_id);
grant select, delete on public.projects to authenticated;
grant insert (user_id, content_id, title) on public.projects to authenticated;
grant update (title) on public.projects to authenticated;

-- Files: readable directly; written only through save_project_file() (revision checks).
create policy "project_files: owner reads" on public.project_files for select to authenticated using ((select auth.uid()) = user_id);
grant select on public.project_files to authenticated;

create policy "notes: owner reads" on public.notes for select to authenticated using ((select auth.uid()) = user_id);
create policy "notes: owner inserts" on public.notes for insert to authenticated with check ((select auth.uid()) = user_id);
create policy "notes: owner updates" on public.notes for update to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "notes: owner deletes" on public.notes for delete to authenticated using ((select auth.uid()) = user_id);
grant select, delete on public.notes to authenticated;
grant insert (user_id, content_id, body) on public.notes to authenticated;
grant update (body) on public.notes to authenticated;

create policy "reflections: owner reads" on public.reflections for select to authenticated using ((select auth.uid()) = user_id);
-- A reflection may only be attached to the learner's own attempt.
create policy "reflections: owner inserts on own attempt" on public.reflections for insert to authenticated with check (
  (select auth.uid()) = user_id
  and exists (select 1 from public.attempts a where a.id = attempt_id and a.user_id = (select auth.uid()))
);
grant select on public.reflections to authenticated;
grant insert (user_id, attempt_id, body) on public.reflections to authenticated;

create policy "recommendation_feedback: owner reads" on public.recommendation_feedback for select to authenticated
  using ((select auth.uid()) = user_id);
create policy "recommendation_feedback: owner inserts on own recommendation" on public.recommendation_feedback
  for insert to authenticated with check (
    (select auth.uid()) = user_id
    and exists (select 1 from public.recommendations r where r.id = recommendation_id and r.user_id = (select auth.uid()))
  );
grant select on public.recommendation_feedback to authenticated;
grant insert (recommendation_id, user_id, feedback, note) on public.recommendation_feedback to authenticated;

-- ---------------------------------------------------------------------------------------------
-- Project file saves with explicit revision conflicts (spec §48, §71)
-- ---------------------------------------------------------------------------------------------

-- SECURITY DEFINER because callers have no direct write grants on project_files; ownership is
-- checked explicitly against auth.uid(). Returns the new revision. Raises 40001
-- (serialization_failure) on a stale expected revision so the client can show a conflict instead
-- of silently overwriting (spec §48, §71). Limits mirror the execution limits in
-- lib/execution/limits.ts (20 files, 200 KB per project) so every saved project can run.
create function public.save_project_file(
  p_project_id uuid,
  p_path text,
  p_expected_revision integer,
  p_source text,
  p_mutation_id uuid
) returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  max_files constant integer := 20;
  max_project_bytes constant integer := 204800;
  v_user uuid := auth.uid();
  v_revision integer;
  v_file_count integer;
  v_other_bytes bigint;
begin
  if v_user is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  -- Lock the project row: serialises saves to one project (file count and size checks below).
  perform 1 from public.projects where id = p_project_id and user_id = v_user for update;
  if not found then
    raise exception 'project not found' using errcode = 'P0002';
  end if;

  -- Replayed outbox mutation: change nothing, report the file's current revision.
  if exists (select 1 from public.sync_mutations where id = p_mutation_id and user_id = v_user) then
    select revision into v_revision from public.project_files where project_id = p_project_id and path = p_path;
    return coalesce(v_revision, 0);
  end if;

  select revision into v_revision from public.project_files where project_id = p_project_id and path = p_path;

  select count(*), coalesce(sum(octet_length(source)), 0) into v_file_count, v_other_bytes
    from public.project_files where project_id = p_project_id and path <> p_path;
  if v_other_bytes + octet_length(p_source) > max_project_bytes then
    raise exception 'project would exceed % bytes of source', max_project_bytes using errcode = '54000';
  end if;

  if v_revision is null then
    if p_expected_revision <> 0 then
      raise exception 'revision conflict: % does not exist (expected revision %)', p_path, p_expected_revision
        using errcode = '40001';
    end if;
    if v_file_count + 1 > max_files then
      raise exception 'project would exceed % files', max_files using errcode = '54000';
    end if;
    insert into public.project_files (project_id, user_id, path, revision, source, last_mutation_id)
      values (p_project_id, v_user, p_path, 1, p_source, p_mutation_id);
    v_revision := 1;
  else
    if v_revision <> p_expected_revision then
      raise exception 'revision conflict: % is at revision %, not %', p_path, v_revision, p_expected_revision
        using errcode = '40001';
    end if;
    v_revision := v_revision + 1;
    update public.project_files
      set source = p_source, revision = v_revision, last_mutation_id = p_mutation_id, updated_at = now()
      where project_id = p_project_id and path = p_path;
  end if;

  insert into public.sync_mutations (id, user_id) values (p_mutation_id, v_user);
  return v_revision;
end;
$$;

revoke all on function public.save_project_file(uuid, text, integer, text, uuid) from public, anon;
grant execute on function public.save_project_file(uuid, text, integer, text, uuid) to authenticated;
