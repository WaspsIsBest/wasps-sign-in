-- WASPS Weekly Sign-In
-- 011: Transactional event assignment import

begin;

create or replace function public.import_event(
    p_event_date date,
    p_event_name text,
    p_entries jsonb,
    p_volunteers jsonb,
    p_is_test boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_role text;
    v_event public.events%rowtype;
    v_entry jsonb;
    v_volunteer jsonb;
    v_weekly_entry_id bigint;
    v_member_id bigint;
    v_class_mapping_id bigint;
    v_volunteer_member_id bigint;
    v_volunteer_entry_id bigint;
    v_entries integer := 0;
    v_bays integer := 0;
    v_volunteers integer := 0;
    v_unmatched integer := 0;
    v_sign_ins integer := 0;
    v_duplicate_entries integer := 0;
    v_source_ticket text;
    v_wasra integer;
    v_detail integer;
    v_bay integer;
    v_volunteer_name text;
begin
    v_role := public.current_staff_role();

    if v_role is null or v_role not in ('admin', 'organiser') then
        return jsonb_build_object(
            'outcome', 'not_authorised',
            'message', 'Only an administrator or organiser may import an event.'
        );
    end if;

    if p_event_date is null then
        return jsonb_build_object('outcome', 'invalid_request', 'message', 'Event date is required.');
    end if;

    if p_entries is null or jsonb_typeof(p_entries) <> 'array' or jsonb_array_length(p_entries) = 0 then
        return jsonb_build_object('outcome', 'invalid_request', 'message', 'At least one event entry is required.');
    end if;

    if jsonb_array_length(p_entries) > 500 then
        return jsonb_build_object('outcome', 'import_too_large', 'message', 'A maximum of 500 entries may be imported.');
    end if;

    select * into v_event
    from public.events
    where event_date = p_event_date
    for update;

    if v_event.id is not null then
        select count(*) into v_sign_ins
        from public.event_sign_ins
        where event_id = v_event.id;

        if v_sign_ins > 0 then
            return jsonb_build_object(
                'outcome', 'event_has_sign_ins',
                'event_id', v_event.id,
                'event_date', v_event.event_date,
                'sign_in_count', v_sign_ins,
                'message', 'This event already has sign-ins and cannot be replaced.'
            );
        end if;

        if v_event.status in ('finalised', 'archived') then
            return jsonb_build_object(
                'outcome', 'event_locked',
                'event_id', v_event.id,
                'event_date', v_event.event_date,
                'message', 'A finalised or archived event cannot be replaced.'
            );
        end if;

        delete from public.volunteer_assignments where event_id = v_event.id;
        delete from public.weekly_entries where event_id = v_event.id;

        update public.events
        set name = coalesce(nullif(trim(p_event_name), ''), 'WASPS Weekly Event'),
            status = 'open',
            sign_in_open = true,
            is_test = p_is_test,
            updated_at = now()
        where id = v_event.id
        returning * into v_event;
    else
        insert into public.events(event_date, name, status, sign_in_open, is_test, created_by)
        values(
            p_event_date,
            coalesce(nullif(trim(p_event_name), ''), 'WASPS Weekly Event'),
            'open', true, p_is_test, (select auth.uid())
        )
        returning * into v_event;
    end if;

    for v_entry in select value from jsonb_array_elements(p_entries)
    loop
        begin
            v_wasra := nullif(v_entry ->> 'wasra_number', '')::integer;
        exception when invalid_text_representation then
            v_wasra := null;
        end;

        if v_wasra is null or v_wasra <= 0 then
            raise exception 'Invalid WASRA number in event import row: %', v_entry;
        end if;

        v_source_ticket := coalesce(
            nullif(v_entry ->> 'source_ticket_number', ''),
            'event-' || to_char(p_event_date, 'YYYYMMDD') || '-' || coalesce(v_entry ->> 'weid', v_wasra::text)
        );

        if exists (
            select 1 from public.weekly_entries
            where event_id = v_event.id and source_ticket_number = v_source_ticket
        ) then
            v_duplicate_entries := v_duplicate_entries + 1;
            continue;
        end if;

        select id into v_member_id
        from public.members
        where wasra_number = v_wasra and is_active = true
        limit 1;

        if v_member_id is null then
            v_unmatched := v_unmatched + 1;
        end if;

        select id into v_class_mapping_id
        from public.class_mappings
        where fkcid = nullif(v_entry ->> 'fkcid', '')::integer
          and mcid = nullif(v_entry ->> 'mcid', '')::integer
          and lower(distance) = lower(v_entry ->> 'distance')
        order by id
        limit 1;

        insert into public.weekly_entries(
            event_id, member_id, source_booking_id, source_ticket_number,
            entry_name, first_name_snapshot, surname_snapshot, wasra_number_snapshot,
            target_type, distance, class_mapping_id, shooting_class_snapshot, position,
            championship_score_eligible, entry_type, volunteer_preference,
            sharing_with_text, attendance_status, import_warning
        )
        values(
            v_event.id,
            v_member_id,
            nullif(v_entry ->> 'source_booking_id', ''),
            v_source_ticket,
            trim(concat_ws(' ', v_entry ->> 'first_name', v_entry ->> 'surname')),
            nullif(v_entry ->> 'first_name', ''),
            nullif(v_entry ->> 'surname', ''),
            v_wasra,
            case when upper(v_entry ->> 'target_type') = 'E' then 'E' else 'P' end,
            v_entry ->> 'distance',
            v_class_mapping_id,
            nullif(v_entry ->> 'shooting_class', ''),
            nullif(v_entry ->> 'position', ''),
            coalesce((v_entry ->> 'championship_score_eligible')::boolean, false),
            case when p_is_test then 'historical' else 'booking' end,
            nullif(v_entry ->> 'volunteer_preference', ''),
            nullif(v_entry ->> 'sharing_with', ''),
            'expected',
            case when v_member_id is null then 'Member not matched by WASRA number' else null end
        )
        returning id into v_weekly_entry_id;

        v_entries := v_entries + 1;

        for v_detail in 1..4 loop
            begin
                v_bay := nullif(v_entry ->> ('d' || v_detail::text), '')::integer;
            exception when invalid_text_representation then
                v_bay := null;
            end;

            if v_bay is not null then
                if v_bay < 1 or v_bay > 99 then
                    raise exception 'Invalid bay % for WASRA % detail %', v_bay, v_wasra, v_detail;
                end if;

                insert into public.bay_assignments(
                    weekly_entry_id, detail_number, bay_number, assignment_type
                ) values(v_weekly_entry_id, v_detail, v_bay, 'manual');
                v_bays := v_bays + 1;
            end if;
        end loop;
    end loop;

    if p_volunteers is not null and jsonb_typeof(p_volunteers) = 'array' then
        for v_volunteer in select value from jsonb_array_elements(p_volunteers)
        loop
            v_volunteer_name := trim(coalesce(v_volunteer ->> 'member_name', ''));
            if v_volunteer_name = '' then
                continue;
            end if;

            v_volunteer_member_id := null;
            v_volunteer_entry_id := null;

            select m.id, we.id
            into v_volunteer_member_id, v_volunteer_entry_id
            from public.members m
            left join public.weekly_entries we
              on we.event_id = v_event.id and we.member_id = m.id
            where lower(regexp_replace(concat_ws(' ', m.first_name, m.surname), '\\s+', ' ', 'g'))
                = lower(regexp_replace(v_volunteer_name, '\\s+', ' ', 'g'))
               or lower(regexp_replace(concat_ws(' ', coalesce(m.preferred_name, m.first_name), m.surname), '\\s+', ' ', 'g'))
                = lower(regexp_replace(v_volunteer_name, '\\s+', ' ', 'g'))
            order by we.id nulls last
            limit 1;

            if v_volunteer_member_id is null then
                raise exception 'Volunteer could not be matched: %', v_volunteer_name;
            end if;

            insert into public.volunteer_assignments(
                event_id, detail_number, role, member_id, weekly_entry_id
            ) values(
                v_event.id,
                (v_volunteer ->> 'detail_number')::integer,
                v_volunteer ->> 'role',
                v_volunteer_member_id,
                v_volunteer_entry_id
            );
            v_volunteers := v_volunteers + 1;
        end loop;
    end if;

    return jsonb_build_object(
        'outcome', 'event_imported',
        'message', 'Event assignments imported successfully.',
        'event_id', v_event.id,
        'event_date', v_event.event_date,
        'entries_imported', v_entries,
        'bay_assignments_imported', v_bays,
        'volunteers_imported', v_volunteers,
        'members_unmatched', v_unmatched,
        'duplicate_entries_skipped', v_duplicate_entries,
        'is_test', v_event.is_test
    );
end;
$$;

revoke all on function public.import_event(date, text, jsonb, jsonb, boolean) from public;
revoke all on function public.import_event(date, text, jsonb, jsonb, boolean) from anon;
grant execute on function public.import_event(date, text, jsonb, jsonb, boolean) to authenticated;

commit;

select routine_name, routine_type
from information_schema.routines
where routine_schema = 'public' and routine_name = 'import_event';
