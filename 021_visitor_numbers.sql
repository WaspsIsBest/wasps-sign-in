-- 021: visitor temporary numbers start at 950000 so they can never clash with
-- the 9000xx numbers used for visitors in the Access database.
create or replace function public.list_event_entries(p_event_id bigint)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_role text := public.current_staff_role();
    v_date date;
begin
    if v_role is null or v_role not in ('admin', 'organiser') then
        return jsonb_build_object('outcome', 'not_authorised', 'message', 'Only an administrator or organiser may do this.');
    end if;

    select event_date into v_date from public.events where id = p_event_id;
    if v_date is null then
        return jsonb_build_object('outcome', 'not_found', 'message', 'Event not found.');
    end if;

    return jsonb_build_object('outcome', 'ok', 'event_date', v_date, 'entries', coalesce((
        select jsonb_agg(jsonb_build_object(
            'id', s.id,
            'submitted_at', s.submitted_at,
            'is_visitor', s.is_visitor,
            'wasra_number', s.wasra_number,
            'effective_number', coalesce(s.wasra_number, 950000 + s.id),
            'first_name', s.first_name,
            'surname', s.surname,
            'target_type', s.target_type,
            'distance', s.distance,
            'shooting_class', s.shooting_class,
            'position', s.position,
            'volunteer_role', s.volunteer_role,
            'sharing_with', s.sharing_with
        ) order by s.id)
        from public.entry_submissions s
        where s.event_id = p_event_id
    ), '[]'::jsonb));
end;
$$;
revoke all on function public.list_event_entries(bigint) from public;
revoke all on function public.list_event_entries(bigint) from anon;
grant execute on function public.list_event_entries(bigint) to authenticated;
