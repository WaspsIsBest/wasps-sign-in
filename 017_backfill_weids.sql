-- WASPS Weekly Sign-In
-- 017: One-off load of the Access WEIDs into Supabase.
-- backfill_weids(rows, apply): with apply = false it only reports what it would do.

create unique index if not exists weekly_entries_weid_unique
    on public.weekly_entries (weid) where weid is not null;

create or replace function public.backfill_weids(p_rows jsonb, p_apply boolean default false)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_role text;
    r jsonb;
    v_idx integer := 0;
    v_weid integer;
    v_wasra integer;
    v_date date;
    v_event_id bigint;
    v_entry_id bigint;
    v_entry_weid integer;
    v_member public.members%rowtype;
    v_status text;
    v_note text;
    v_dups integer[];
    v_counts jsonb := '{}'::jsonb;
    v_problems jsonb := '[]'::jsonb;
    v_result jsonb;
    v_detail integer;
    v_bay integer;
begin
    v_role := public.current_staff_role();
    if v_role is null or v_role not in ('admin', 'organiser') then
        return jsonb_build_object('outcome', 'not_authorised',
            'message', 'Only an administrator or organiser may load WEIDs.');
    end if;

    if p_rows is null or jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) = 0 then
        return jsonb_build_object('outcome', 'invalid_request', 'message', 'No rows were supplied.');
    end if;
    if jsonb_array_length(p_rows) > 5000 then
        return jsonb_build_object('outcome', 'import_too_large', 'message', 'A maximum of 5000 rows may be loaded.');
    end if;

    select coalesce(array_agg(w), '{}') into v_dups
    from (
        select (x ->> 'weid')::integer as w
        from jsonb_array_elements(p_rows) x
        where nullif(x ->> 'weid', '') is not null
        group by 1 having count(*) > 1
    ) d;

    begin
        for r in select value from jsonb_array_elements(p_rows)
        loop
            v_idx := v_idx + 1;
            v_status := null;
            v_note := null;
            v_weid := nullif(r ->> 'weid', '')::integer;
            v_wasra := nullif(r ->> 'wasra', '')::integer;
            v_date := nullif(r ->> 'event_date', '')::date;

            if v_weid is null then
                v_status := 'skipped_no_weid';
            elsif v_weid = any (v_dups) then
                v_status := 'skipped_duplicate_weid';
                v_note := 'This WEID appears more than once in the file.';
            elsif v_wasra is null or v_wasra <= 0 then
                v_status := 'skipped_no_wasra';
            elsif v_date is null then
                v_status := 'skipped_no_date';
            else
                select id into v_event_id from public.events where event_date = v_date;
                if v_event_id is null then
                    v_status := 'skipped_no_event';
                    v_note := 'No event exists on this date.';
                else
                    -- an entry that already has this WEID, else one with no WEID yet
                    v_entry_id := null;
                    select id, weid into v_entry_id, v_entry_weid
                    from public.weekly_entries
                    where event_id = v_event_id and wasra_number_snapshot = v_wasra
                      and (weid is null or weid = v_weid)
                    order by (weid is null), id
                    limit 1;

                    if v_entry_id is not null and v_entry_weid = v_weid then
                        v_status := 'already_loaded';
                    elsif exists (select 1 from public.weekly_entries where weid = v_weid) then
                        v_status := 'skipped_weid_in_use';
                        v_note := 'This WEID is already used by another entry.';
                    elsif v_entry_id is not null then
                        update public.weekly_entries set weid = v_weid, updated_at = now() where id = v_entry_id;
                        v_status := 'matched';
                    else
                        select * into v_member from public.members
                        where wasra_number = v_wasra
                        order by is_active desc nulls last, id limit 1;

                        insert into public.weekly_entries(
                            event_id, member_id, source_ticket_number,
                            entry_name, first_name_snapshot, surname_snapshot, wasra_number_snapshot,
                            target_type, distance, championship_score_eligible, entry_type,
                            attendance_status, import_warning, weid
                        ) values (
                            v_event_id, v_member.id, 'access-weid-' || v_weid,
                            coalesce(nullif(trim(concat_ws(' ', v_member.first_name, v_member.surname)), ''),
                                     nullif(trim(r ->> 'name'), ''), 'Unknown'),
                            v_member.first_name, v_member.surname, v_wasra,
                            case when upper(r ->> 'target_type') = 'E' then 'E' else 'P' end,
                            nullif(r ->> 'distance', ''),
                            upper(coalesce(r ->> 'cscore', '')) = 'Y',
                            'historical', 'expected',
                            'Loaded from the Access database'
                              || case when v_member.id is null then '; member not matched by WASRA number' else '' end,
                            v_weid
                        ) returning id into v_entry_id;

                        for v_detail in 1..4 loop
                            begin
                                v_bay := nullif(r ->> ('d' || v_detail), '')::integer;
                            exception when invalid_text_representation then
                                v_bay := null;
                            end;
                            if v_bay is not null and v_bay between 1 and 32 then
                                insert into public.bay_assignments(weekly_entry_id, detail_number, bay_number, assignment_type)
                                values (v_entry_id, v_detail, v_bay, 'manual');
                            end if;
                        end loop;
                        v_status := case when exists (
                            select 1 from public.weekly_entries
                            where event_id = v_event_id and wasra_number_snapshot = v_wasra and id <> v_entry_id
                        ) then 'created_extra' else 'created' end;
                    end if;
                end if;
            end if;

            if v_status = 'created_extra' then
                v_note := 'Second Access row for this person on this date, created as an extra entry.';
            end if;

            v_counts := jsonb_set(v_counts, array[v_status],
                to_jsonb(coalesce((v_counts ->> v_status)::integer, 0) + 1));

            if v_status not in ('matched', 'created', 'already_loaded') and v_status <> 'skipped_no_wasra'
               and not (v_status = 'skipped_no_weid' and v_wasra is null) then
                if jsonb_array_length(v_problems) < 300 then
                    v_problems := v_problems || jsonb_build_array(jsonb_build_object(
                        'row', v_idx, 'weid', v_weid, 'event_date', v_date, 'wasra', v_wasra,
                        'name', r ->> 'name', 'status', v_status, 'note', v_note));
                end if;
            end if;
        end loop;

        v_result := jsonb_build_object(
            'outcome', case when p_apply then 'loaded' else 'preview' end,
            'applied', p_apply, 'rows', v_idx, 'counts', v_counts, 'problems', v_problems);

        if not p_apply then
            raise exception using errcode = 'WB001', message = 'preview', detail = v_result::text;
        end if;
    exception when sqlstate 'WB001' then
        get stacked diagnostics v_note = pg_exception_detail;
        v_result := v_note::jsonb;
    end;

    return v_result;
end;
$$;

revoke all on function public.backfill_weids(jsonb, boolean) from public;
revoke all on function public.backfill_weids(jsonb, boolean) from anon;
grant execute on function public.backfill_weids(jsonb, boolean) to authenticated;
