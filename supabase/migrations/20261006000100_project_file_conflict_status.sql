-- Revision conflicts in save_project_file() used SQLSTATE 40001 (serialization_failure). That
-- code means "retry me" to the infrastructure, so the API layer retried an application-level
-- conflict that can never succeed and the request hung until the client deadline. Use PT409,
-- which PostgREST returns immediately as HTTP 409 Conflict.

-- SECURITY DEFINER because callers have no direct write grants on project_files; ownership is
-- checked explicitly against auth.uid(). Returns the new revision. Raises PT409 on a stale
-- expected revision (PostgREST maps PTxxx to that HTTP status: 409 Conflict) so the client can
-- show a conflict instead of silently overwriting (spec §48, §71). Limits mirror the execution limits in
-- lib/execution/limits.ts (20 files, 200 KB per project) so every saved project can run.
create or replace function public.save_project_file(
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
        using errcode = 'PT409';
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
        using errcode = 'PT409';
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
