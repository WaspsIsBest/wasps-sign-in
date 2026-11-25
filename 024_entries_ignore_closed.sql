-- 024: Entries are controlled by the "Open entries" switch and the event date.
-- An event whose calendar status says "closed" (it can be set by other actions
-- in the app) must not hide it from the entry form. Past events are already
-- excluded by the date check, and cancelled or finalised events stay hidden.
create temp table _entries_closed_result (fn text, outcome text);

do $$
declare
    r record;
    v_def text;
    v_new text;
begin
    for r in
        select p.oid, p.proname
        from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public' and p.proname in ('list_open_events', 'submit_entry')
    loop
        v_def := pg_get_functiondef(r.oid);
        v_new := regexp_replace(v_def,
            '\(\s*''cancelled''\s*,\s*''finalised''\s*,\s*''closed''\s*\)',
            '(''cancelled'', ''finalised'')', 'g');
        if v_new = v_def then
            insert into _entries_closed_result values (r.proname, 'NOT CHANGED - send this to Claude');
        else
            execute v_new;
            insert into _entries_closed_result values (r.proname, 'updated');
        end if;
    end loop;
end;
$$;

select * from _entries_closed_result order by fn;
