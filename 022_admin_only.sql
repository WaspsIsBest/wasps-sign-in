-- 022: Make the set-up and data-loading functions administrator-only.
-- Organisers (the sign-on team) keep: allocate/import event, online entries,
-- start lists, set active event, open/close sign-in, and signing people in.
--
-- Each function below has its own copy of the role check. This rewrites the
-- check in place (keeping the rest of the function exactly as it is) so that
-- only 'admin' passes. The result table at the end says what happened.
create temp table _admin_only_result (fn text, outcome text);

do $$
declare
    r record;
    v_def text;
    v_new text;
begin
    for r in
        select p.oid, p.proname, pg_get_function_identity_arguments(p.oid) as args
        from pg_proc p
        join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public'
          and p.proname in ('create_calendar_event', 'backfill_weids',
                            'load_championship_scores', 'export_weids')
    loop
        v_def := pg_get_functiondef(r.oid);
        v_new := regexp_replace(v_def,
                  '\(\s*''admin''\s*,\s*''organiser''\s*\)', '(''admin'')', 'g');
        v_new := regexp_replace(v_new,
                  '\(\s*''organiser''\s*,\s*''admin''\s*\)', '(''admin'')', 'g');
        v_new := replace(v_new, 'administrator or organiser', 'administrator');

        if v_new = v_def then
            insert into _admin_only_result
            values (r.proname, 'NOT CHANGED - role check not recognised; send it to Claude');
        else
            execute v_new;
            insert into _admin_only_result values (r.proname, 'now administrator-only');
        end if;
    end loop;

    insert into _admin_only_result
    select f, 'NOT FOUND in this database'
    from unnest(array['create_calendar_event', 'backfill_weids',
                      'load_championship_scores', 'export_weids']) f
    where not exists (select 1 from _admin_only_result x where x.fn = f);
end;
$$;

select * from _admin_only_result order by fn;
