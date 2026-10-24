-- Personal flashcards (spec §51): made from the learner's own notes, only when they choose to,
-- in their own words, linked back to the problem or practice set the note belongs to. Review uses
-- a five-box Leitner schedule (lib/learning/flashcards.ts). Cards are learner-authored: always
-- exported and imported, deleted with the learner's data. The export key is omitted when empty.

create table public.flashcards (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (user_id) on delete cascade,
  content_id text not null references public.content_items (id) on delete restrict,
  front text not null check (char_length(front) between 1 and 500),
  back text not null check (char_length(back) between 1 and 2000),
  box smallint not null default 1 check (box between 1 and 5),
  due_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index flashcards_user_due_idx on public.flashcards (user_id, due_at);

alter table public.flashcards enable row level security;
create policy "flashcards: owner reads" on public.flashcards for select to authenticated using ((select auth.uid()) = user_id);
revoke all on public.flashcards from anon, authenticated;
grant select on public.flashcards to authenticated;

alter function public.export_user_data(uuid) rename to export_user_data_v4;
alter function public.import_user_data(uuid, jsonb, boolean) rename to import_user_data_v4;
alter function public.delete_user_data(uuid) rename to delete_user_data_v3;

create function public.export_user_data(p_user_id uuid) returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select public.export_user_data_v4(p_user_id) || coalesce((
    select jsonb_build_object('flashcards', jsonb_agg(jsonb_build_object(
        'id', f.id, 'content_id', f.content_id, 'front', f.front, 'back', f.back, 'box', f.box, 'due_at', f.due_at,
        'created_at', f.created_at, 'updated_at', f.updated_at) order by f.created_at, f.id))
    from public.flashcards f
    where f.user_id = p_user_id
    having count(*) > 0), '{}'::jsonb);
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
  v_report := public.import_user_data_v4(p_user_id, p_data, p_include_progress);

  select count(*) into v_total from jsonb_array_elements(coalesce(p_data -> 'flashcards', '[]'));
  with inserted as (
    insert into public.flashcards (id, user_id, content_id, front, back, box, due_at, created_at, updated_at)
      select x.id, p_user_id, x.content_id, x.front, x.back, x.box, x.due_at, x.created_at, x.updated_at
      from jsonb_to_recordset(coalesce(p_data -> 'flashcards', '[]'))
        as x(id uuid, content_id text, front text, back text, box smallint, due_at timestamptz, created_at timestamptz, updated_at timestamptz)
      where exists (select 1 from public.content_items c where c.id = x.content_id)
      on conflict do nothing
      returning 1)
  select count(*) into v_done from inserted;
  return v_report || jsonb_build_object('flashcards', jsonb_build_object('imported', v_done, 'skipped', v_total - v_done));
end;
$$;

create function public.delete_user_data(p_user_id uuid) returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  delete from public.flashcards where user_id = p_user_id;
  perform public.delete_user_data_v3(p_user_id);
end;
$$;

revoke all on function public.export_user_data_v4(uuid) from public, anon, authenticated;
revoke all on function public.import_user_data_v4(uuid, jsonb, boolean) from public, anon, authenticated;
revoke all on function public.delete_user_data_v3(uuid) from public, anon, authenticated;
revoke all on function public.export_user_data(uuid) from public, anon, authenticated;
revoke all on function public.import_user_data(uuid, jsonb, boolean) from public, anon, authenticated;
revoke all on function public.delete_user_data(uuid) from public, anon, authenticated;
grant execute on function public.export_user_data(uuid) to service_role;
grant execute on function public.import_user_data(uuid, jsonb, boolean) to service_role;
grant execute on function public.delete_user_data(uuid) to service_role;
