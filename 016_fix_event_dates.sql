-- WASPS Weekly Sign-In
-- 016: Move entries from the two events dated a day early (12 Aug, 26 Aug) onto the
-- correct 13 Aug and 27 Aug events, and remove the empty duplicate 2 Sep event.
-- Safe to run more than once. It changes nothing for an event that has any
-- other data attached, and reports what it did in the "Messages" panel.

do $$
declare
    v_pair record;
    v_src public.events%rowtype;
    v_dst public.events%rowtype;
    v_fk record;
    v_other integer;
    v_total integer;
begin
    for v_pair in
        select * from (values
            (date '2026-08-12', date '2026-08-13'),
            (date '2026-08-26', date '2026-08-27')
        ) as t(src_date, dst_date)
    loop
        select * into v_src from public.events where event_date = v_pair.src_date;
        select * into v_dst from public.events where event_date = v_pair.dst_date;

        if v_src.id is null then
            raise notice '% : no event on that date, nothing to move.', v_pair.src_date;
            continue;
        end if;
        if v_dst.id is null then
            raise notice '% : target event on % does not exist, skipped.', v_pair.src_date, v_pair.dst_date;
            continue;
        end if;

        -- anything other than entries, volunteers and sign-ins pointing at the old event?
        v_other := 0;
        for v_fk in
            select c.conrelid::regclass as tbl, a.attname as col, c.conrelid
            from pg_constraint c
            join pg_attribute a on a.attrelid = c.conrelid and a.attnum = c.conkey[1]
            where c.contype = 'f' and c.confrelid = 'public.events'::regclass
              and array_length(c.conkey, 1) = 1
              and c.conrelid not in (
                  'public.weekly_entries'::regclass,
                  'public.volunteer_assignments'::regclass,
                  'public.event_sign_ins'::regclass)
        loop
            execute format('select count(*) from %s where %I = $1', v_fk.tbl, v_fk.col)
                into v_total using v_src.id;
            v_other := v_other + v_total;
        end loop;

        if v_other > 0 then
            raise notice '% : event % has other linked data, skipped.', v_pair.src_date, v_src.id;
            continue;
        end if;

        if exists (select 1 from public.weekly_entries where event_id = v_dst.id) then
            raise notice '% : target event % already has entries, skipped.', v_pair.dst_date, v_dst.id;
            continue;
        end if;

        update public.weekly_entries set event_id = v_dst.id where event_id = v_src.id;
        update public.volunteer_assignments set event_id = v_dst.id where event_id = v_src.id;
        update public.event_sign_ins set event_id = v_dst.id where event_id = v_src.id;

        update public.events d set
            status = s.status,
            assignments_imported = s.assignments_imported,
            volunteers_imported = s.volunteers_imported,
            assignment_source_name = s.assignment_source_name,
            assignment_imported_at = s.assignment_imported_at,
            assignment_imported_by = s.assignment_imported_by,
            opened_by = s.opened_by,
            opened_at = s.opened_at,
            closed_by = s.closed_by,
            closed_at = s.closed_at
        from public.events s
        where d.id = v_dst.id and s.id = v_src.id;

        delete from public.events where id = v_src.id;
        raise notice '% : entries moved onto the % event (id %), old event removed.',
            v_pair.src_date, v_pair.dst_date, v_dst.id;
    end loop;

    -- empty duplicate for 2 Sep
    select * into v_src from public.events where event_date = date '2026-09-02';
    if v_src.id is not null
       and not exists (select 1 from public.weekly_entries where event_id = v_src.id)
       and not exists (select 1 from public.volunteer_assignments where event_id = v_src.id)
       and not exists (select 1 from public.event_sign_ins where event_id = v_src.id) then
        begin
            delete from public.events where id = v_src.id;
            raise notice '2026-09-02 : empty duplicate event removed.';
        exception when foreign_key_violation then
            raise notice '2026-09-02 : event has other linked data, left in place.';
        end;
    end if;
end;
$$;
