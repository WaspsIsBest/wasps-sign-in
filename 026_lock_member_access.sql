-- 026: Lock down the three objects the 025 check showed as open (RLS OFF),
-- so member logins (and anyone not logged in) cannot read them.
--   app_sign_in_roster, visitor_search, weekly_entry_legacy_export
-- Staff (anyone with an active user_profiles role) keep exactly what they see now.
-- Also removes TRUNCATE from logged-in users on every public table.
-- Safe to run more than once. The result table at the end says what happened.

create temp table _lock_result (object text, outcome text);

do $$
declare
    v_name text;
    v_kind "char";
    v_def text;
begin
    foreach v_name in array array['app_sign_in_roster', 'visitor_search', 'weekly_entry_legacy_export']
    loop
        select c.relkind into v_kind
        from pg_class c join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'public' and c.relname = v_name;

        if v_kind is null then
            insert into _lock_result values (v_name, 'NOT FOUND');
            continue;
        end if;

        -- Nobody who is not logged in should ever read these.
        execute format('revoke all on public.%I from anon', v_name);
        -- Logged-in users only ever need to read them.
        execute format('revoke insert, update, delete, truncate, references, trigger on public.%I from authenticated', v_name);

        if v_kind = 'v' then
            v_def := pg_get_viewdef(format('public.%I', v_name)::regclass, true);
            if v_def ~ 'current_staff_role\(\) IS NOT NULL\s*;?\s*$' then
                insert into _lock_result values (v_name, 'view - already staff-only');
            else
                v_def := regexp_replace(v_def, ';\s*$', '');
                execute format(
                    'create or replace view public.%I as select staff_only.* from (%s) staff_only where public.current_staff_role() is not null',
                    v_name, v_def);
                insert into _lock_result values (v_name, 'view - now staff-only');
            end if;
        elsif v_kind = 'r' then
            execute format('alter table public.%I enable row level security', v_name);
            execute format('drop policy if exists %I on public.%I', v_name || '_staff_read', v_name);
            execute format(
                'create policy %I on public.%I for select to authenticated using (public.current_staff_role() is not null)',
                v_name || '_staff_read', v_name);
            insert into _lock_result values (v_name, 'table - RLS on, staff read only');
        else
            insert into _lock_result values (v_name, 'NOT CHANGED - unexpected type ' || v_kind || '; send to Claude');
        end if;
    end loop;

    -- TRUNCATE skips row-level security, so no logged-in user should have it.
    for v_name in
        select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'public' and c.relkind = 'r'
    loop
        execute format('revoke truncate on public.%I from anon, authenticated', v_name);
    end loop;
    insert into _lock_result values ('all tables', 'TRUNCATE removed from anon and authenticated');

    -- Does the staff check ignore deactivated staff?
    insert into _lock_result
    select 'current_staff_role()',
           case when pg_get_functiondef('public.current_staff_role'::regproc) ~* 'is_active'
                then 'checks is_active - OK'
                else 'does NOT check is_active - send to Claude' end;
end;
$$;

select * from _lock_result order by object;
