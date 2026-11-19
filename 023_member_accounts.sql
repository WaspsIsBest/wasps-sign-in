-- 023: Member accounts. A member creates a login (email + password, handled by
-- Supabase), proves who they are once with their WASRA number and surname, and
-- from then on enters events without typing their name or number.

create table if not exists public.member_accounts (
    user_id uuid primary key references auth.users(id) on delete cascade,
    wasra_number integer not null unique,
    member_id bigint,
    linked_at timestamptz not null default now()
);
alter table public.member_accounts enable row level security;
revoke all on public.member_accounts from anon, authenticated;

-- Beta switch. While this table has any rows, ONLY these WASRA numbers can
-- link an account. Empty = every current member may link.
create table if not exists public.member_portal_allowlist (
    wasra_number integer primary key,
    note text
);
alter table public.member_portal_allowlist enable row level security;
revoke all on public.member_portal_allowlist from anon, authenticated;

-- Who am I? (the signed-in person's linked member, if any)
create or replace function public.member_portal_status()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_wasra integer;
    v_member public.members%rowtype;
begin
    if auth.uid() is null then
        return jsonb_build_object('outcome', 'not_signed_in');
    end if;

    select wasra_number into v_wasra from public.member_accounts where user_id = auth.uid();
    if v_wasra is null then
        return jsonb_build_object('outcome', 'not_linked');
    end if;

    select * into v_member from public.members m where m.wasra_number = v_wasra order by m.id limit 1;
    return jsonb_build_object('outcome', 'linked', 'wasra_number', v_wasra,
        'first_name', coalesce(v_member.first_name, ''), 'surname', coalesce(v_member.surname, ''));
end;
$$;

-- One-off: tie this login to a member record.
create or replace function public.link_member_account(p_wasra text, p_surname text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_wasra integer;
    v_surname text := regexp_replace(trim(coalesce(p_surname, '')), '\s+', ' ', 'g');
    v_member public.members%rowtype;
    v_confirmed timestamptz;
begin
    if auth.uid() is null then
        return jsonb_build_object('outcome', 'not_signed_in', 'message', 'Please sign in first.');
    end if;

    select email_confirmed_at into v_confirmed from auth.users where id = auth.uid();
    if v_confirmed is null then
        return jsonb_build_object('outcome', 'email_not_confirmed',
            'message', 'Confirm your email address first. Check your inbox for the confirmation link.');
    end if;

    if exists (select 1 from public.member_accounts where user_id = auth.uid()) then
        return jsonb_build_object('outcome', 'already_linked', 'message', 'Your login is already linked to a member.');
    end if;

    if coalesce(p_wasra, '') !~ '^\s*[0-9]{1,6}\s*$' then
        return jsonb_build_object('outcome', 'invalid_request', 'message', 'Enter your WASRA number using digits only.');
    end if;
    v_wasra := trim(p_wasra)::integer;
    if v_wasra <= 0 or v_wasra >= 900000 or v_surname = '' then
        return jsonb_build_object('outcome', 'invalid_request', 'message', 'Enter your WASRA number and surname.');
    end if;

    select * into v_member
    from public.members m
    where m.wasra_number = v_wasra
      and m.is_active = true
      and regexp_replace(lower(m.surname), '[^a-z]', '', 'g') = regexp_replace(lower(v_surname), '[^a-z]', '', 'g')
    order by m.id
    limit 1;

    if v_member.id is null then
        return jsonb_build_object('outcome', 'member_not_found',
            'message', 'We could not match that WASRA number and surname to a current member. Check your membership card.');
    end if;

    if exists (select 1 from public.member_portal_allowlist)
       and not exists (select 1 from public.member_portal_allowlist where wasra_number = v_wasra) then
        return jsonb_build_object('outcome', 'not_in_beta',
            'message', 'Member logins are in a trial with a few members. You can still enter at the normal entry page for now.');
    end if;

    begin
        insert into public.member_accounts(user_id, wasra_number, member_id)
        values (auth.uid(), v_wasra, v_member.id);
    exception when unique_violation then
        return jsonb_build_object('outcome', 'already_claimed',
            'message', 'That membership already has a login. Ask an organiser if this is a mistake.');
    end;

    return jsonb_build_object('outcome', 'linked', 'wasra_number', v_wasra,
        'first_name', v_member.first_name, 'surname', v_member.surname);
end;
$$;

-- Enter an event as the linked member. Uses the same checks and rules as the
-- public entry form (one entry per member per event, entries must be open).
create or replace function public.submit_member_entry(
    p_event_id bigint,
    p_target_type text,
    p_distance text,
    p_shooting_class text,
    p_position text,
    p_volunteer_role text default null,
    p_sharing_with text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_wasra integer;
    v_surname text;
begin
    if auth.uid() is null then
        return jsonb_build_object('outcome', 'not_signed_in', 'message', 'Please sign in first.');
    end if;

    select ma.wasra_number, m.surname into v_wasra, v_surname
    from public.member_accounts ma
    left join public.members m on m.wasra_number = ma.wasra_number and m.is_active = true
    where ma.user_id = auth.uid()
    order by m.id
    limit 1;

    if v_wasra is null then
        return jsonb_build_object('outcome', 'not_linked', 'message', 'Link your membership first.');
    end if;
    if v_surname is null then
        return jsonb_build_object('outcome', 'member_not_found', 'message', 'Your membership is not current. Contact an organiser.');
    end if;

    return public.submit_entry(
        p_event_id, false, v_wasra::text, '', v_surname,
        p_target_type, p_distance, p_shooting_class, p_position,
        p_volunteer_role, p_sharing_with, null
    );
end;
$$;

-- My entries for events that are today or later.
create or replace function public.my_entries()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_wasra integer;
begin
    if auth.uid() is null then
        return jsonb_build_object('outcome', 'not_signed_in');
    end if;
    select wasra_number into v_wasra from public.member_accounts where user_id = auth.uid();
    if v_wasra is null then
        return jsonb_build_object('outcome', 'ok', 'entries', '[]'::jsonb);
    end if;

    return jsonb_build_object('outcome', 'ok', 'entries', coalesce((
        select jsonb_agg(jsonb_build_object(
            'id', s.id, 'event_date', e.event_date, 'shooting_class', s.shooting_class,
            'position', s.position, 'distance', s.distance, 'target_type', s.target_type,
            'entries_open', coalesce(e.entries_open, false)
        ) order by e.event_date)
        from public.entry_submissions s
        join public.events e on e.id = s.event_id
        where s.wasra_number = v_wasra and e.event_date >= current_date
    ), '[]'::jsonb));
end;
$$;

-- Withdraw my own entry while entries for that event are still open.
create or replace function public.cancel_my_entry(p_entry_id bigint)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_wasra integer;
    v_open boolean;
    v_found bigint;
begin
    if auth.uid() is null then
        return jsonb_build_object('outcome', 'not_signed_in', 'message', 'Please sign in first.');
    end if;
    select wasra_number into v_wasra from public.member_accounts where user_id = auth.uid();

    select s.id, coalesce(e.entries_open, false) into v_found, v_open
    from public.entry_submissions s join public.events e on e.id = s.event_id
    where s.id = p_entry_id and s.wasra_number = v_wasra;

    if v_found is null then
        return jsonb_build_object('outcome', 'not_found', 'message', 'Entry not found.');
    end if;
    if not v_open then
        return jsonb_build_object('outcome', 'closed',
            'message', 'Entries for that event are closed. Contact an organiser to change it.');
    end if;

    delete from public.entry_submissions where id = v_found;
    return jsonb_build_object('outcome', 'ok');
end;
$$;

revoke all on function public.member_portal_status() from public, anon;
revoke all on function public.link_member_account(text, text) from public, anon;
revoke all on function public.submit_member_entry(bigint, text, text, text, text, text, text) from public, anon;
revoke all on function public.my_entries() from public, anon;
revoke all on function public.cancel_my_entry(bigint) from public, anon;
grant execute on function public.member_portal_status() to authenticated;
grant execute on function public.link_member_account(text, text) to authenticated;
grant execute on function public.submit_member_entry(bigint, text, text, text, text, text, text) to authenticated;
grant execute on function public.my_entries() to authenticated;
grant execute on function public.cancel_my_entry(bigint) to authenticated;

-- To run the trial with a few members only, add their WASRA numbers, e.g.:
--   insert into public.member_portal_allowlist (wasra_number, note) values (1234, 'Paul');
-- Remove every row to open it to all current members.
