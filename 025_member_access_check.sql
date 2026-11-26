-- 025: CHECK ONLY - changes nothing.
-- Shows everything a logged-in MEMBER (no user_profiles row) could reach,
-- so we can lock down anything that should be staff-only before member
-- logins are emailed out. Run it in the Supabase SQL editor and send back
-- the result table.

with
-- 1. Tables a logged-in user can touch directly, and the RLS rules on them.
tbl as (
    select
        '1 table' as kind,
        c.relname as name,
        case when c.relrowsecurity then 'RLS on' else 'RLS OFF' end as rls,
        string_agg(distinct g.privilege_type, ', ') as granted_to_authenticated,
        (
            select string_agg(p.policyname || ' [' || p.cmd || ' to ' || array_to_string(p.roles, ',') ||
                   '] using: ' || coalesce(p.qual, '-') || ' check: ' || coalesce(p.with_check, '-'), ' || ')
            from pg_policies p
            where p.schemaname = 'public' and p.tablename = c.relname
        ) as detail
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace and n.nspname = 'public'
    left join information_schema.role_table_grants g
        on g.table_schema = 'public' and g.table_name = c.relname
       and g.grantee in ('authenticated', 'PUBLIC')
    where c.relkind in ('r', 'v', 'm')
    group by c.relname, c.relrowsecurity
),
-- 2. Functions a logged-in user can call, and whether they check staff role.
fn as (
    select
        '2 function' as kind,
        p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')' as name,
        case when p.prosecdef then 'security definer' else 'invoker' end as rls,
        'execute' as granted_to_authenticated,
        case
            when pg_get_functiondef(p.oid) ~* 'current_staff_role|user_profiles' then 'checks staff role'
            when pg_get_functiondef(p.oid) ~* 'member_accounts' then 'member-only (own data)'
            else 'NO ROLE CHECK - review'
        end as detail
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace and n.nspname = 'public'
    where p.prokind = 'f'
      and has_function_privilege('authenticated', p.oid, 'execute')
)
select * from tbl
where granted_to_authenticated is not null or rls = 'RLS OFF'
union all
select * from fn
order by kind, name;

-- Also send the text of this function (it decides who counts as staff):
-- select pg_get_functiondef('public.current_staff_role'::regproc);
