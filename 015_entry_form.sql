-- WASPS Weekly Sign-In
-- 015: Public entry form (replaces collecting entries through TryBooking)
--
--   * events.entries_open        organisers switch entries on/off per event
--   * entry_submissions          one row per entry; NOT readable by the public
--   * list_open_events()         public: events currently taking entries
--   * entry_options()            public: classes and distances to choose from
--   * submit_entry(...)          public: validated, rate-limited entry
--   * admin_list_entry_events(), set_entries_open(), list_event_entries(),
--     delete_event_entry()       staff only (admin / organiser)
--
-- Safe to run more than once.

begin;

alter table public.events add column if not exists entries_open boolean not null default false;

create table if not exists public.entry_submissions (
    id bigint generated always as identity primary key,
    event_id bigint not null references public.events(id) on delete cascade,
    submitted_at timestamptz not null default now(),
    member_id bigint,
    wasra_number integer,            -- null for visitors
    is_visitor boolean not null default false,
    first_name text not null,
    surname text not null,
    target_type text not null check (target_type in ('Electronic', 'Paper')),
    distance text not null,
    shooting_class text not null,    -- full label, equals class_mappings.source_shooting_class
    position text not null default '',
    volunteer_role text,
    sharing_with text,
    constraint entry_submissions_text_len check (
        char_length(first_name) <= 60 and char_length(surname) <= 60
        and char_length(coalesce(sharing_with, '')) <= 120
    )
);

-- A member can enter once per event; a visitor is identified by name.
create unique index if not exists entry_submissions_member_once
    on public.entry_submissions (event_id, wasra_number) where wasra_number is not null;
create unique index if not exists entry_submissions_visitor_once
    on public.entry_submissions (event_id, lower(first_name), lower(surname)) where wasra_number is null;
create index if not exists entry_submissions_event_idx on public.entry_submissions (event_id);
create index if not exists entry_submissions_time_idx on public.entry_submissions (submitted_at);

-- Nobody reads or writes this table directly; only the functions below do.
alter table public.entry_submissions enable row level security;
revoke all on table public.entry_submissions from public;
revoke all on table public.entry_submissions from anon;
revoke all on table public.entry_submissions from authenticated;

-- ------------------------------------------------------------------ public

create or replace function public.list_open_events()
returns jsonb
language sql
security definer
set search_path = ''
as $$
    select coalesce(jsonb_agg(
        jsonb_build_object(
            'id', e.id,
            'event_date', e.event_date,
            'name', e.name,
            'start_time', e.start_time,
            'end_time', e.end_time
        ) order by e.event_date, e.id
    ), '[]'::jsonb)
    from public.events e
    where e.entries_open
      and e.event_date >= (now() at time zone 'Australia/Perth')::date
      and coalesce(e.calendar_status, '') not in ('cancelled', 'finalised', 'closed')
      and coalesce(e.status, '') not in ('finalised', 'archived');
$$;

create or replace function public.entry_options()
returns jsonb
language sql
security definer
set search_path = ''
as $$
    select jsonb_build_object(
        'classes', coalesce((
            select jsonb_agg(
                jsonb_build_object(
                    'source_shooting_class', c.source_shooting_class,
                    'distance', c.distance
                ) order by c.distance, c.id
            )
            from public.class_mappings c
            where c.is_active is not false
              and c.source_shooting_class is not null
              and c.distance is not null
        ), '[]'::jsonb)
    );
$$;

create or replace function public.submit_entry(
    p_event_id bigint,
    p_is_visitor boolean,
    p_wasra text,
    p_first_name text,
    p_surname text,
    p_target_type text,
    p_distance text,
    p_shooting_class text,
    p_position text,
    p_volunteer_role text default null,
    p_sharing_with text default null,
    p_website text default null          -- honeypot: real people leave this empty
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_event public.events%rowtype;
    v_member public.members%rowtype;
    v_first text := regexp_replace(trim(coalesce(p_first_name, '')), '\s+', ' ', 'g');
    v_surname text := regexp_replace(trim(coalesce(p_surname, '')), '\s+', ' ', 'g');
    v_wasra integer;
    v_class text;
    v_distance text;
    v_position text;
    v_role text;
    v_sharing text := nullif(left(regexp_replace(trim(coalesce(p_sharing_with, '')), '\s+', ' ', 'g'), 120), '');
    v_id bigint;
    v_recent integer;
    v_total integer;
begin
    -- Honeypot: look successful to a bot, save nothing.
    if nullif(trim(coalesce(p_website, '')), '') is not null then
        return jsonb_build_object('outcome', 'entry_received', 'message', 'Entry received.');
    end if;

    select * into v_event from public.events where id = p_event_id;

    if v_event.id is null
       or not v_event.entries_open
       or v_event.event_date < (now() at time zone 'Australia/Perth')::date
       or coalesce(v_event.calendar_status, '') in ('cancelled', 'finalised', 'closed')
       or coalesce(v_event.status, '') in ('finalised', 'archived') then
        return jsonb_build_object('outcome', 'entries_closed',
            'message', 'Entries are not open for that event.');
    end if;

    -- Throttle: a flood of entries in one minute, or a runaway total, is refused.
    select count(*) into v_recent from public.entry_submissions where submitted_at > now() - interval '1 minute';
    if v_recent >= 30 then
        return jsonb_build_object('outcome', 'too_busy',
            'message', 'Too many entries at once. Please wait a minute and try again.');
    end if;
    select count(*) into v_total from public.entry_submissions where event_id = p_event_id;
    if v_total >= 250 then
        return jsonb_build_object('outcome', 'entries_full',
            'message', 'This event is full. Please contact an organiser.');
    end if;

    -- Choices must be exactly what the form offers.
    if p_target_type not in ('Electronic', 'Paper') then
        return jsonb_build_object('outcome', 'invalid_request', 'message', 'Choose Electronic or Paper.');
    end if;

    select c.source_shooting_class, c.distance
    into v_class, v_distance
    from public.class_mappings c
    where c.is_active is not false
      and c.source_shooting_class = p_shooting_class
      and lower(c.distance) = lower(coalesce(p_distance, ''))
    order by c.id
    limit 1;

    if v_class is null then
        return jsonb_build_object('outcome', 'invalid_request', 'message', 'Choose a class and distance from the list.');
    end if;

    if lower(v_class) like '%benchrest%' then
        v_position := 'Benchrest';
    elsif p_position in ('Prone', 'Other position') then
        v_position := p_position;
    else
        return jsonb_build_object('outcome', 'invalid_request', 'message', 'Choose your shooting position.');
    end if;

    v_role := nullif(trim(coalesce(p_volunteer_role, '')), '');
    if v_role is not null and v_role not in ('Range Officer', 'Trainee Range Officer', 'Visitor Assistant') then
        return jsonb_build_object('outcome', 'invalid_request', 'message', 'Choose a volunteer role from the list.');
    end if;

    -- Who is entering.
    if coalesce(p_is_visitor, false) then
        if v_first = '' or v_surname = '' then
            return jsonb_build_object('outcome', 'invalid_request', 'message', 'First name and surname are required.');
        end if;
        if v_first !~ '^[A-Za-z\u00C0-\u024F][A-Za-z\u00C0-\u024F ''.-]{0,59}$' or v_surname !~ '^[A-Za-z\u00C0-\u024F][A-Za-z\u00C0-\u024F ''.-]{0,59}$' then
            return jsonb_build_object('outcome', 'invalid_request',
                'message', 'Names can only use letters, spaces, hyphens, apostrophes and full stops.');
        end if;
    else
        if coalesce(p_wasra, '') !~ '^\s*[0-9]{1,6}\s*$' then
            return jsonb_build_object('outcome', 'invalid_request', 'message', 'Enter your WASRA number using digits only.');
        end if;
        v_wasra := trim(p_wasra)::integer;
        if v_wasra <= 0 or v_wasra >= 900000 then
            return jsonb_build_object('outcome', 'invalid_request', 'message', 'Enter your WASRA number using digits only.');
        end if;
        if v_surname = '' then
            return jsonb_build_object('outcome', 'invalid_request', 'message', 'Surname is required.');
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
                'message', 'We could not match that WASRA number and surname to a current member. Check your membership card, or choose Visitor.');
        end if;

        -- Use the name on the membership record.
        v_first := v_member.first_name;
        v_surname := v_member.surname;
    end if;

    begin
        insert into public.entry_submissions(
            event_id, member_id, wasra_number, is_visitor, first_name, surname,
            target_type, distance, shooting_class, position, volunteer_role, sharing_with
        ) values (
            p_event_id, v_member.id, v_wasra, coalesce(p_is_visitor, false), v_first, v_surname,
            p_target_type, v_distance, v_class, v_position, v_role, v_sharing
        )
        returning id into v_id;
    exception when unique_violation then
        return jsonb_build_object('outcome', 'already_entered',
            'message', 'You are already entered in this event. Contact an organiser if something needs changing.');
    end;

    return jsonb_build_object(
        'outcome', 'entry_received',
        'entry_id', v_id,
        'name', v_first || ' ' || v_surname,
        'event_date', v_event.event_date,
        'message', 'Entry received.'
    );
end;
$$;

-- ------------------------------------------------------------- staff only

create or replace function public.admin_list_entry_events()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_role text := public.current_staff_role();
begin
    if v_role is null or v_role not in ('admin', 'organiser') then
        return jsonb_build_object('outcome', 'not_authorised', 'message', 'Only an administrator or organiser may do this.');
    end if;

    return jsonb_build_object('outcome', 'ok', 'events', coalesce((
        select jsonb_agg(x order by x.event_date desc, x.id desc)
        from (
            select e.id, e.event_date, e.name, e.entries_open, e.calendar_status,
                   (select count(*) from public.entry_submissions s where s.event_id = e.id) as entry_count
            from public.events e
            order by e.event_date desc, e.id desc
            limit 40
        ) x
    ), '[]'::jsonb));
end;
$$;

create or replace function public.set_entries_open(p_event_id bigint, p_open boolean)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_role text := public.current_staff_role();
begin
    if v_role is null or v_role not in ('admin', 'organiser') then
        return jsonb_build_object('outcome', 'not_authorised', 'message', 'Only an administrator or organiser may do this.');
    end if;

    update public.events set entries_open = coalesce(p_open, false), updated_at = now()
    where id = p_event_id;

    if not found then
        return jsonb_build_object('outcome', 'not_found', 'message', 'Event not found.');
    end if;
    return jsonb_build_object('outcome', 'ok', 'entries_open', coalesce(p_open, false));
end;
$$;

create or replace function public.list_event_entries(p_event_id bigint)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_role text := public.current_staff_role();
    v_date date;
begin
    if v_role is null or v_role not in ('admin', 'organiser') then
        return jsonb_build_object('outcome', 'not_authorised', 'message', 'Only an administrator or organiser may do this.');
    end if;

    select event_date into v_date from public.events where id = p_event_id;
    if v_date is null then
        return jsonb_build_object('outcome', 'not_found', 'message', 'Event not found.');
    end if;

    return jsonb_build_object('outcome', 'ok', 'event_date', v_date, 'entries', coalesce((
        select jsonb_agg(jsonb_build_object(
            'id', s.id,
            'submitted_at', s.submitted_at,
            'is_visitor', s.is_visitor,
            'wasra_number', s.wasra_number,
            -- Visitors have no WASRA number; give each a stable temporary one
            -- (6 digits starting with 9, so it can never clash with a member).
            'effective_number', coalesce(s.wasra_number, 900000 + s.id),
            'first_name', s.first_name,
            'surname', s.surname,
            'target_type', s.target_type,
            'distance', s.distance,
            'shooting_class', s.shooting_class,
            'position', s.position,
            'volunteer_role', s.volunteer_role,
            'sharing_with', s.sharing_with
        ) order by s.id)
        from public.entry_submissions s
        where s.event_id = p_event_id
    ), '[]'::jsonb));
end;
$$;

create or replace function public.delete_event_entry(p_entry_id bigint)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_role text := public.current_staff_role();
begin
    if v_role is null or v_role not in ('admin', 'organiser') then
        return jsonb_build_object('outcome', 'not_authorised', 'message', 'Only an administrator or organiser may do this.');
    end if;

    delete from public.entry_submissions where id = p_entry_id;
    if not found then
        return jsonb_build_object('outcome', 'not_found', 'message', 'Entry not found.');
    end if;
    return jsonb_build_object('outcome', 'ok');
end;
$$;

-- ------------------------------------------------------------- permissions

revoke all on function public.list_open_events() from public;
revoke all on function public.entry_options() from public;
revoke all on function public.submit_entry(bigint, boolean, text, text, text, text, text, text, text, text, text, text) from public;
grant execute on function public.list_open_events() to anon, authenticated;
grant execute on function public.entry_options() to anon, authenticated;
grant execute on function public.submit_entry(bigint, boolean, text, text, text, text, text, text, text, text, text, text) to anon, authenticated;

revoke all on function public.admin_list_entry_events() from public;
revoke all on function public.admin_list_entry_events() from anon;
revoke all on function public.set_entries_open(bigint, boolean) from public;
revoke all on function public.set_entries_open(bigint, boolean) from anon;
revoke all on function public.list_event_entries(bigint) from public;
revoke all on function public.list_event_entries(bigint) from anon;
revoke all on function public.delete_event_entry(bigint) from public;
revoke all on function public.delete_event_entry(bigint) from anon;
grant execute on function public.admin_list_entry_events() to authenticated;
grant execute on function public.set_entries_open(bigint, boolean) to authenticated;
grant execute on function public.list_event_entries(bigint) to authenticated;
grant execute on function public.delete_event_entry(bigint) to authenticated;

commit;

select routine_name
from information_schema.routines
where routine_schema = 'public'
  and routine_name in ('list_open_events', 'entry_options', 'submit_entry',
                       'admin_list_entry_events', 'set_entries_open',
                       'list_event_entries', 'delete_event_entry')
order by routine_name;
