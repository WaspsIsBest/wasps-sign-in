-- 020: Build Meyton start lists from what is in Supabase (includes late entries).

-- Recent and upcoming events, newest first.
create or replace function public.list_recent_events()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare v_role text;
begin
    v_role := public.current_staff_role();
    if v_role is null or v_role not in ('admin', 'organiser') then
        return jsonb_build_object('outcome', 'not_authorised', 'message', 'Not allowed.');
    end if;
    return jsonb_build_object('outcome', 'ok', 'events', coalesce((
        select jsonb_agg(jsonb_build_object('id', e.id, 'event_date', e.event_date,
               'entries', (select count(*) from public.weekly_entries we where we.event_id = e.id))
               order by e.event_date desc)
        from (select * from public.events order by event_date desc limit 12) e
    ), '[]'::jsonb));
end;
$$;
revoke all on function public.list_recent_events() from public;
revoke all on function public.list_recent_events() from anon;
grant execute on function public.list_recent_events() to authenticated;

-- Every entry for the event, with its WEID. Any entry without a WEID (for
-- example a late entry added on the night) is given the next free one first,
-- so the same WEID is used in the start list, the export and the scores.
create or replace function public.event_start_list(p_event_id bigint)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_role text;
    v_date date;
    v_next integer;
    r record;
    v_new jsonb := '[]'::jsonb;
begin
    v_role := public.current_staff_role();
    if v_role is null or v_role not in ('admin', 'organiser') then
        return jsonb_build_object('outcome', 'not_authorised',
            'message', 'Only an administrator or organiser may build start lists.');
    end if;

    select event_date into v_date from public.events where id = p_event_id;
    if v_date is null then
        return jsonb_build_object('outcome', 'not_found', 'message', 'Event not found.');
    end if;

    perform pg_advisory_xact_lock(7770019);

    select coalesce(max(weid), 0) + 1 into v_next from public.weekly_entries;

    for r in
        select we.id from public.weekly_entries we
        where we.event_id = p_event_id and we.weid is null
        order by we.id
    loop
        update public.weekly_entries set weid = v_next where id = r.id;
        v_new := v_new || to_jsonb(v_next);
        v_next := v_next + 1;
    end loop;

    return jsonb_build_object('outcome', 'ok', 'event_date', v_date, 'new_weids', v_new,
      'rows', coalesce((
        select jsonb_agg(x order by x.weid)
        from (
            select we.weid,
                   we.first_name_snapshot as first_name,
                   we.surname_snapshot as surname,
                   we.entry_name,
                   we.wasra_number_snapshot as wasra,
                   we.target_type,
                   we.distance,
                   cm.fkcid,
                   cm.mcid,
                   (select ba.bay_number from public.bay_assignments ba where ba.weekly_entry_id = we.id and ba.detail_number = 1 limit 1) as d1,
                   (select ba.bay_number from public.bay_assignments ba where ba.weekly_entry_id = we.id and ba.detail_number = 2 limit 1) as d2,
                   (select ba.bay_number from public.bay_assignments ba where ba.weekly_entry_id = we.id and ba.detail_number = 3 limit 1) as d3,
                   (select ba.bay_number from public.bay_assignments ba where ba.weekly_entry_id = we.id and ba.detail_number = 4 limit 1) as d4
            from public.weekly_entries we
            left join public.class_mappings cm on cm.id = we.class_mapping_id
            where we.event_id = p_event_id
        ) x
    ), '[]'::jsonb));
end;
$$;
revoke all on function public.event_start_list(bigint) from public;
revoke all on function public.event_start_list(bigint) from anon;
grant execute on function public.event_start_list(bigint) to authenticated;
