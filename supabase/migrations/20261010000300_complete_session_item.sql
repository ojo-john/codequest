-- Completing a practice-set session item (spec §5). Quest items complete when a submission
-- passes (record_graded_attempt); a practice set completes once every question has been
-- answered since the session started, which the server checks before calling this. Completes
-- the session too when this was its last open item.

create function public.complete_session_item(p_user_id uuid, p_item_id uuid) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_session_id uuid;
  v_session_completed boolean := false;
begin
  update public.session_items si
    set state = 'completed'
    where si.id = p_item_id
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

  return jsonb_build_object('completed', v_session_id is not null, 'session_completed', v_session_completed);
end;
$$;

revoke all on function public.complete_session_item(uuid, uuid) from public, anon, authenticated;
grant execute on function public.complete_session_item(uuid, uuid) to service_role;
