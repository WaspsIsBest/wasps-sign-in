-- 027: Member login invites, sent in batches.
--   * member_invites            one row per member to invite (WASRA number + email)
--   * admin_load_invites(rows)  admin: load/refresh the list from a CSV/Excel file
--   * admin_list_invites()      admin: the list with status and counts
--   * admin_requeue_invite(id)  admin: put one back in the queue (resend / retry)
-- The emails themselves are sent by the app's server (/api/admin/send-invites)
-- using the secret key, which also links each new login to its member, so
-- invited members skip the "link your membership" step.
-- An invited login is NOT staff: nothing here touches user_profiles.
-- Safe to run more than once.

create table if not exists public.member_invites (
    id bigint generated always as identity primary key,
    wasra_number integer not null unique,
    member_id bigint,
    email text not null,
    status text not null default 'pending'
        check (status in ('pending', 'sent', 'failed', 'skipped')),
    message text,
    user_id uuid,
    loaded_at timestamptz not null default now(),
    sent_at timestamptz,
    send_count integer not null default 0
);
alter table public.member_invites enable row level security;
revoke all on public.member_invites from anon, authenticated;

-- Load or refresh the invite list. p_rows: [{"wasra": 1234, "email": "a@b.com"}, ...]
create or replace function public.admin_load_invites(p_rows jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
    r jsonb;
    v_wasra integer;
    v_email text;
    v_member public.members%rowtype;
    v_existing public.member_invites%rowtype;
    c_added integer := 0;
    c_updated integer := 0;
    c_unchanged integer := 0;
    c_has_login integer := 0;
    problems jsonb := '[]'::jsonb;
    v_line integer := 0;
begin
    if coalesce(public.current_staff_role(), '') <> 'admin' then
        return jsonb_build_object('outcome', 'not_authorised', 'message', 'Only an administrator may load invites.');
    end if;
    if jsonb_typeof(p_rows) <> 'array' then
        return jsonb_build_object('outcome', 'invalid_request', 'message', 'No rows were sent.');
    end if;

    for r in select * from jsonb_array_elements(p_rows)
    loop
        v_line := v_line + 1;
        v_email := lower(trim(coalesce(r ->> 'email', '')));
        if coalesce(r ->> 'wasra', '') !~ '^\s*[0-9]{1,6}\s*$' then
            problems := problems || jsonb_build_object('line', v_line, 'wasra', r ->> 'wasra', 'email', v_email, 'problem', 'No valid WASRA number');
            continue;
        end if;
        v_wasra := trim(r ->> 'wasra')::integer;
        if v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
            problems := problems || jsonb_build_object('line', v_line, 'wasra', v_wasra, 'email', v_email, 'problem', 'No valid email address');
            continue;
        end if;

        v_member := null;
        select * into v_member from public.members m
        where m.wasra_number = v_wasra and m.is_active = true
        order by m.id limit 1;
        if v_member.id is null then
            problems := problems || jsonb_build_object('line', v_line, 'wasra', v_wasra, 'email', v_email, 'problem', 'Not a current member');
            continue;
        end if;

        v_existing := null;
        select * into v_existing from public.member_invites where wasra_number = v_wasra;

        if v_existing.id is null then
            if exists (select 1 from public.member_accounts where wasra_number = v_wasra) then
                insert into public.member_invites (wasra_number, member_id, email, status, message)
                values (v_wasra, v_member.id, v_email, 'skipped', 'Already has a member login');
                c_has_login := c_has_login + 1;
            else
                insert into public.member_invites (wasra_number, member_id, email)
                values (v_wasra, v_member.id, v_email);
                c_added := c_added + 1;
            end if;
        elsif v_existing.email = v_email then
            c_unchanged := c_unchanged + 1;
        elsif v_existing.status in ('pending', 'failed') then
            -- New email for someone not yet invited: take it and queue again.
            update public.member_invites
            set email = v_email, status = 'pending', message = null, member_id = v_member.id
            where id = v_existing.id;
            c_updated := c_updated + 1;
        else
            problems := problems || jsonb_build_object('line', v_line, 'wasra', v_wasra, 'email', v_email,
                'problem', 'Already invited at ' || v_existing.email || ' - email not changed');
        end if;
    end loop;

    return jsonb_build_object('outcome', 'loaded', 'added', c_added, 'updated', c_updated,
        'unchanged', c_unchanged, 'already_have_login', c_has_login, 'problems', problems);
end;
$$;

-- The invite list, with whether each person has signed in yet.
create or replace function public.admin_list_invites()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
    if coalesce(public.current_staff_role(), '') <> 'admin' then
        return jsonb_build_object('outcome', 'not_authorised', 'message', 'Only an administrator may view invites.');
    end if;

    return jsonb_build_object('outcome', 'ok', 'invites', coalesce((
        select jsonb_agg(jsonb_build_object(
            'id', i.id, 'wasra_number', i.wasra_number, 'email', i.email,
            'name', trim(coalesce(m.first_name, '') || ' ' || coalesce(m.surname, '')),
            'status', case when i.status = 'sent' and u.last_sign_in_at is not null then 'joined' else i.status end,
            'message', i.message, 'sent_at', i.sent_at, 'send_count', i.send_count
        ) order by m.surname, m.first_name, i.wasra_number)
        from public.member_invites i
        left join public.members m on m.id = i.member_id
        left join auth.users u on u.id = i.user_id
    ), '[]'::jsonb));
end;
$$;

-- Put an invite back in the queue (resend a sent one, or retry a failed one).
create or replace function public.admin_requeue_invite(p_id bigint)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
    if coalesce(public.current_staff_role(), '') <> 'admin' then
        return jsonb_build_object('outcome', 'not_authorised', 'message', 'Only an administrator may resend invites.');
    end if;
    update public.member_invites set status = 'pending', message = null
    where id = p_id and status in ('sent', 'failed');
    if not found then
        return jsonb_build_object('outcome', 'not_found', 'message', 'That invite cannot be resent.');
    end if;
    return jsonb_build_object('outcome', 'ok');
end;
$$;

revoke all on function public.admin_load_invites(jsonb) from public, anon;
revoke all on function public.admin_list_invites() from public, anon;
revoke all on function public.admin_requeue_invite(bigint) from public, anon;
grant execute on function public.admin_load_invites(jsonb) to authenticated;
grant execute on function public.admin_list_invites() to authenticated;
grant execute on function public.admin_requeue_invite(bigint) to authenticated;
