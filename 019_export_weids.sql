-- 019: Export entries with their WEID, for loading into the Access database.
create or replace function public.export_weids(p_from date, p_to date)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_role text;
begin
    v_role := public.current_staff_role();
    if v_role is null or v_role not in ('admin', 'organiser') then
        return jsonb_build_object('outcome', 'not_authorised',
            'message', 'Only an administrator or organiser may export WEIDs.');
    end if;

    return jsonb_build_object('outcome', 'ok', 'rows', coalesce((
        select jsonb_agg(x order by x.event_date, x.weid)
        from (
            select we.weid,
                   ev.event_date,
                   we.wasra_number_snapshot as wasra,
                   coalesce(nullif(trim(concat_ws(' ', we.first_name_snapshot, we.surname_snapshot)), ''), we.entry_name) as name,
                   we.target_type,
                   we.distance,
                   case when we.championship_score_eligible then 'Y' else 'N' end as cscore,
                   we.entry_type,
                   we.source_ticket_number as booking_id,
                   cm.fkcid,
                   cm.mcid as fkmcid,
                   (select ba.bay_number from public.bay_assignments ba where ba.weekly_entry_id = we.id and ba.detail_number = 1 limit 1) as d1,
                   (select ba.bay_number from public.bay_assignments ba where ba.weekly_entry_id = we.id and ba.detail_number = 2 limit 1) as d2,
                   (select ba.bay_number from public.bay_assignments ba where ba.weekly_entry_id = we.id and ba.detail_number = 3 limit 1) as d3,
                   (select ba.bay_number from public.bay_assignments ba where ba.weekly_entry_id = we.id and ba.detail_number = 4 limit 1) as d4
            from public.weekly_entries we
            join public.events ev on ev.id = we.event_id
            left join public.class_mappings cm on cm.id = we.class_mapping_id
            where we.weid is not null
              and ev.event_date between p_from and p_to
        ) x
    ), '[]'::jsonb));
end;
$$;

revoke all on function public.export_weids(date, date) from public;
revoke all on function public.export_weids(date, date) from anon;
grant execute on function public.export_weids(date, date) to authenticated;
