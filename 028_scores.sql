-- WASPS Weekly Sign-In
-- 028: Scores kept in Supabase, night by night.
--
-- Every score belongs to one entry (weekly_entries row, so one WEID) and one
-- detail. Scores come from the Meyton CSV export or are typed in (90m, paper,
-- anything Meyton missed). Saving a night only touches that night's entries;
-- nothing ever wipes a season.
--
-- The same table feeds:
--   * weekly results              weekly_results(event_id)
--   * the championship (2027 on)  season_standings(season)
--   * each member's own analysis  my_scores()
--
-- 2026 history: load_history_scores() copies every Access ScoreT score into
-- this table (matched by WEID to the backfilled 2026 entries), so all years
-- live in one place. The old 2026 championship copy (championship_scores, 018)
-- is left as it is.
--
-- To try the championship maths on the December/January test nights, run:
--   update public.score_seasons set starts_on = '2026-12-01' where season = 2027;
-- and put it back to '2027-02-01' before the season starts.
-- Safe to run more than once.

-- ---------------------------------------------------------------- tables

create table if not exists public.scores (
    id bigserial primary key,
    event_id bigint not null references public.events(id) on delete restrict,
    weekly_entry_id bigint not null references public.weekly_entries(id) on delete restrict,
    detail smallint not null check (detail between 1 and 4),
    score numeric(7, 2) not null check (score >= 0 and score <= 1000),
    inners integer check (inners is null or inners between 0 and 200),
    source text not null check (source in ('meyton', 'manual', 'access')),
    meyton_list text,          -- Rangliste / event code from the Meyton export
    shot_at timestamptz,       -- Zeitstempel from the Meyton export
    entered_by uuid,
    entered_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    unique (weekly_entry_id, detail)
);
create index if not exists scores_event_idx on public.scores (event_id);

-- Championship seasons. Scores outside a season's dates still show in weekly
-- results and member history; they just do not count to the championship.
create table if not exists public.score_seasons (
    season integer primary key,
    starts_on date not null,
    ends_on date not null,
    best_50m integer not null default 10,
    best_90m integer not null default 5,
    check (ends_on >= starts_on)
);
insert into public.score_seasons(season, starts_on, ends_on, best_50m, best_90m)
values (2027, '2027-02-01', '2027-11-30', 10, 5)
on conflict (season) do nothing;

alter table public.scores drop constraint if exists scores_source_check;
alter table public.scores add constraint scores_source_check check (source in ('meyton', 'manual', 'access'));

alter table public.scores enable row level security;
alter table public.score_seasons enable row level security;
revoke all on public.scores from public, anon, authenticated;
revoke all on public.score_seasons from public, anon, authenticated;

-- ---------------------------------------------------------------- helpers

-- Championship class from the Access class number (FKCID), as in 018.
create or replace function public.score_class_name(p_fkcid integer, p_snapshot text)
returns text
language sql
immutable
set search_path = ''
as $$
    select case
        when p_fkcid in (1, 7) then 'Sporter'
        when p_fkcid in (2, 8) then 'Modified'
        when p_fkcid in (3, 9) then 'F-Open'
        when p_fkcid in (14, 15) then 'Benchrest'
        else coalesce(nullif(trim(p_snapshot), ''), 'Unknown')
    end;
$$;

-- One row per score with everything the reports need.
create or replace view public.score_details
with (security_invoker = true) as
select s.id,
       s.event_id,
       e.event_date,
       s.weekly_entry_id,
       we.weid,
       we.wasra_number_snapshot as wasra,
       coalesce(
           nullif(trim(concat_ws(' ', coalesce(nullif(m.preferred_name, ''), m.first_name), m.surname)), ''),
           nullif(trim(concat_ws(' ', we.first_name_snapshot, we.surname_snapshot)), ''),
           we.entry_name) as name,
       lower(trim(we.distance)) as distance,
       public.score_class_name(cm.fkcid, we.shooting_class_snapshot) as class_name,
       we.position,
       upper(left(coalesce(we.target_type, ''), 1)) as target_type,
       coalesce(we.championship_score_eligible, false) as eligible,
       s.detail,
       s.score,
       s.inners,
       s.source
from public.scores s
join public.events e on e.id = s.event_id
join public.weekly_entries we on we.id = s.weekly_entry_id
left join public.class_mappings cm on cm.id = we.class_mapping_id
left join lateral (
    select first_name, surname, preferred_name from public.members
    where wasra_number = we.wasra_number_snapshot
    order by is_active desc nulls last, id limit 1
) m on true;
revoke all on public.score_details from public, anon, authenticated;

-- ------------------------------------------------- staff: the night's score sheet

-- Every entry for the event with its bays and any scores already saved.
create or replace function public.event_score_sheet(p_event_id bigint)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
    v_role text := public.current_staff_role();
    v_date date;
begin
    if v_role is null or v_role not in ('admin', 'organiser') then
        return jsonb_build_object('outcome', 'not_authorised', 'message', 'Only an administrator or organiser may enter scores.');
    end if;
    select event_date into v_date from public.events where id = p_event_id;
    if v_date is null then
        return jsonb_build_object('outcome', 'not_found', 'message', 'Event not found.');
    end if;

    return jsonb_build_object('outcome', 'ok', 'event_id', p_event_id, 'event_date', v_date,
      'entries', coalesce((
        select jsonb_agg(x order by x.distance, x.name)
        from (
            select we.id as weekly_entry_id,
                   we.weid,
                   we.wasra_number_snapshot as wasra,
                   coalesce(nullif(trim(concat_ws(' ', we.first_name_snapshot, we.surname_snapshot)), ''), we.entry_name) as name,
                   lower(trim(we.distance)) as distance,
                   public.score_class_name(cm.fkcid, we.shooting_class_snapshot) as class_name,
                   upper(left(coalesce(we.target_type, ''), 1)) as target_type,
                   coalesce(we.championship_score_eligible, false) as eligible,
                   (select jsonb_object_agg(ba.detail_number::text, ba.bay_number)
                      from public.bay_assignments ba where ba.weekly_entry_id = we.id) as bays,
                   (select jsonb_object_agg(s.detail::text, jsonb_build_object('score', s.score, 'inners', s.inners, 'source', s.source))
                      from public.scores s where s.weekly_entry_id = we.id) as scores
            from public.weekly_entries we
            left join public.class_mappings cm on cm.id = we.class_mapping_id
            where we.event_id = p_event_id
        ) x
      ), '[]'::jsonb));
end;
$$;

-- Save (insert or replace) scores for one event.
-- p_rows: [{weekly_entry_id, detail, score, inners?, meyton_list?, shot_at?}]
create or replace function public.save_event_scores(p_event_id bigint, p_rows jsonb, p_source text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_role text := public.current_staff_role();
    v_bad integer;
    v_added integer;
    v_changed integer;
begin
    if v_role is null or v_role not in ('admin', 'organiser') then
        return jsonb_build_object('outcome', 'not_authorised', 'message', 'Only an administrator or organiser may save scores.');
    end if;
    if p_source not in ('meyton', 'manual') then
        return jsonb_build_object('outcome', 'invalid_request', 'message', 'Unknown score source.');
    end if;
    if not exists (select 1 from public.events where id = p_event_id) then
        return jsonb_build_object('outcome', 'not_found', 'message', 'Event not found.');
    end if;
    if p_rows is null or jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) = 0 then
        return jsonb_build_object('outcome', 'invalid_request', 'message', 'No scores were supplied.');
    end if;
    if jsonb_array_length(p_rows) > 1000 then
        return jsonb_build_object('outcome', 'invalid_request', 'message', 'Too many rows for one night.');
    end if;

    drop table if exists pg_temp._in;
    create temp table _in on commit drop as
    select (x ->> 'weekly_entry_id')::bigint as weekly_entry_id,
           (x ->> 'detail')::smallint as detail,
           round((x ->> 'score')::numeric, 2) as score,
           nullif(x ->> 'inners', '')::integer as inners,
           nullif(x ->> 'meyton_list', '') as meyton_list,
           nullif(x ->> 'shot_at', '')::timestamptz as shot_at
    from jsonb_array_elements(p_rows) x;

    -- Every row must be an entry of this event, a real detail and a sensible score.
    select count(*) into v_bad
    from pg_temp._in i
    left join public.weekly_entries we on we.id = i.weekly_entry_id and we.event_id = p_event_id
    where we.id is null or i.detail not between 1 and 4 or i.score is null or i.score < 0 or i.score > 1000;
    if v_bad > 0 then
        return jsonb_build_object('outcome', 'invalid_request',
            'message', v_bad || ' row(s) are not entries of this event or have an invalid detail or score. Nothing was saved.');
    end if;
    if exists (select 1 from pg_temp._in group by weekly_entry_id, detail having count(*) > 1) then
        return jsonb_build_object('outcome', 'invalid_request', 'message', 'The same entry and detail appears twice. Nothing was saved.');
    end if;

    select count(*) into v_changed from pg_temp._in i
    join public.scores s on s.weekly_entry_id = i.weekly_entry_id and s.detail = i.detail
    where s.score is distinct from i.score or s.inners is distinct from i.inners;
    select count(*) into v_added from pg_temp._in i
    where not exists (select 1 from public.scores s where s.weekly_entry_id = i.weekly_entry_id and s.detail = i.detail);

    insert into public.scores(event_id, weekly_entry_id, detail, score, inners, source, meyton_list, shot_at, entered_by)
    select p_event_id, weekly_entry_id, detail, score, inners, p_source, meyton_list, shot_at, auth.uid()
    from pg_temp._in
    on conflict (weekly_entry_id, detail) do update
       set score = excluded.score,
           inners = excluded.inners,
           source = excluded.source,
           meyton_list = coalesce(excluded.meyton_list, public.scores.meyton_list),
           shot_at = coalesce(excluded.shot_at, public.scores.shot_at),
           entered_by = excluded.entered_by,
           updated_at = now()
     where public.scores.score is distinct from excluded.score
        or public.scores.inners is distinct from excluded.inners;

    return jsonb_build_object('outcome', 'saved', 'added', v_added, 'changed', v_changed,
        'unchanged', jsonb_array_length(p_rows) - v_added - v_changed);
end;
$$;

create or replace function public.delete_event_score(p_event_id bigint, p_weekly_entry_id bigint, p_detail integer)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_role text := public.current_staff_role();
    v_n integer;
begin
    if v_role is null or v_role not in ('admin', 'organiser') then
        return jsonb_build_object('outcome', 'not_authorised', 'message', 'Only an administrator or organiser may remove scores.');
    end if;
    delete from public.scores
    where event_id = p_event_id and weekly_entry_id = p_weekly_entry_id and detail = p_detail;
    get diagnostics v_n = row_count;
    return jsonb_build_object('outcome', case when v_n > 0 then 'deleted' else 'not_found' end);
end;
$$;

-- -------------------------------------------- signed-in users: results and standings

-- Nights that have scores, newest first.
create or replace function public.score_events()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
    if auth.uid() is null then
        return jsonb_build_object('outcome', 'not_signed_in');
    end if;
    return jsonb_build_object('outcome', 'ok', 'events', coalesce((
        select jsonb_agg(jsonb_build_object('id', x.id, 'event_date', x.event_date, 'scores', x.n) order by x.event_date desc)
        from (
            select e.id, e.event_date, count(s.id) as n
            from public.events e join public.scores s on s.event_id = e.id
            group by e.id, e.event_date
        ) x
    ), '[]'::jsonb));
end;
$$;

-- One night's results: one row per entry with its detail scores.
create or replace function public.weekly_results(p_event_id bigint)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
    if auth.uid() is null then
        return jsonb_build_object('outcome', 'not_signed_in');
    end if;
    return jsonb_build_object('outcome', 'ok',
      'event_date', (select event_date from public.events where id = p_event_id),
      'rows', coalesce((
        select jsonb_agg(r order by r.distance, r.class_name, r.best desc, r.name)
        from (
            select d.weekly_entry_id, d.wasra, d.name, d.distance, d.class_name, d.target_type, d.position,
                   jsonb_object_agg(d.detail::text, jsonb_build_object('score', d.score, 'inners', d.inners)) as details,
                   max(d.score) as best,
                   sum(d.score) as total,
                   count(*) as shot
            from public.score_details d
            where d.event_id = p_event_id
            group by d.weekly_entry_id, d.wasra, d.name, d.distance, d.class_name, d.target_type, d.position
        ) r
      ), '[]'::jsonb));
end;
$$;

-- Championship standings from the scores table, same shape as
-- championship_standings (018) so the championship page can show either.
-- 50m counts electronic scores only; only entries marked for the championship.
create or replace function public.season_standings(p_season integer)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
    v_s public.score_seasons%rowtype;
    v_result jsonb;
begin
    if auth.uid() is null then
        return jsonb_build_object('outcome', 'not_signed_in');
    end if;
    select * into v_s from public.score_seasons where season = p_season;
    if v_s.season is null then
        return jsonb_build_object('outcome', 'not_found', 'message', 'No season set up for ' || p_season || '.');
    end if;

    with counted as (
        select d.* from public.score_details d
        where d.event_date between v_s.starts_on and v_s.ends_on
          and d.eligible and d.wasra is not null
          and d.distance in ('50m', '90m')
          and (d.distance = '90m' or d.target_type = 'E')
    ),
    ranked as (
        select c.*, row_number() over (
            partition by wasra, class_name, distance
            order by score desc, coalesce(inners, 0) desc, event_date, detail) as pos
        from counted c
    ),
    best as (
        select wasra as wasra_number, class_name, distance, max(name) as display_name,
               count(*) as counted, sum(score) as total, coalesce(sum(inners), 0) as inners,
               array_agg(score order by score desc, event_date) as scores
        from ranked
        where (distance = '50m' and pos <= v_s.best_50m) or (distance = '90m' and pos <= v_s.best_90m)
        group by wasra, class_name, distance
    ),
    s50 as (
        select class_name, wasra_number, display_name, counted, total, scores,
               rank() over (partition by class_name order by total desc) as rnk
        from best where distance = '50m'
    ),
    s90 as (
        select class_name, wasra_number, display_name, counted, total, inners, scores,
               rank() over (partition by class_name order by total desc, inners desc) as rnk
        from best where distance = '90m'
    ),
    dual as (
        select a.class_name, a.wasra_number, a.display_name,
               a.counted as n50, b.counted as n90, a.total as total50, b.total as total90,
               b.inners, a.total + b.total as total,
               rank() over (partition by a.class_name order by a.total + b.total desc, b.inners desc) as rnk
        from s50 a join s90 b on a.wasra_number = b.wasra_number and a.class_name = b.class_name
    )
    select jsonb_build_object(
        'outcome', 'ok',
        'season', p_season,
        'starts_on', v_s.starts_on,
        'ends_on', v_s.ends_on,
        'best_50m', v_s.best_50m,
        'best_90m', v_s.best_90m,
        'last_night', (select max(event_date) from counted),
        'loaded_at', null,
        'standings_50m', coalesce((select jsonb_agg(jsonb_build_object('class', class_name, 'rank', rnk, 'wasra', wasra_number,
            'name', display_name, 'counted', counted, 'total', total, 'scores', scores) order by class_name, rnk, display_name) from s50), '[]'::jsonb),
        'standings_90m', coalesce((select jsonb_agg(jsonb_build_object('class', class_name, 'rank', rnk, 'wasra', wasra_number,
            'name', display_name, 'counted', counted, 'total', total, 'inners', inners, 'scores', scores) order by class_name, rnk, display_name) from s90), '[]'::jsonb),
        'standings_dual', coalesce((select jsonb_agg(jsonb_build_object('class', class_name, 'rank', rnk, 'wasra', wasra_number,
            'name', display_name, 'n50', n50, 'n90', n90, 'total50', total50, 'total90', total90, 'inners', inners, 'total', total)
            order by class_name, rnk, display_name) from dual), '[]'::jsonb)
    ) into v_result;
    return v_result;
end;
$$;

-- ------------------------------------------------------- members: my own scores

-- The signed-in member's scores (all of them), plus what the club scored in the
-- same class and distance on the same nights, for comparison.
create or replace function public.my_scores()
returns jsonb
language plpgsql
stable
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
        return jsonb_build_object('outcome', 'not_linked');
    end if;

    return jsonb_build_object('outcome', 'ok', 'wasra', v_wasra,
      'seasons', coalesce((select jsonb_agg(jsonb_build_object('season', season, 'starts_on', starts_on, 'ends_on', ends_on,
            'best_50m', best_50m, 'best_90m', best_90m) order by season) from public.score_seasons), '[]'::jsonb),
      'scores', coalesce((
        select jsonb_agg(jsonb_build_object(
                 'event_date', d.event_date, 'distance', d.distance, 'class_name', d.class_name,
                 'target_type', d.target_type, 'eligible', d.eligible, 'detail', d.detail,
                 'score', d.score, 'inners', d.inners,
                 'field_avg', f.avg_score, 'field_best', f.best_score, 'field_n', f.n,
                 'place', f.place)
               order by d.event_date, d.detail)
        from public.score_details d
        left join lateral (
            select round(avg(o.score), 2) as avg_score, max(o.score) as best_score, count(*) as n,
                   1 + count(*) filter (where o.score > d.score) as place
            from public.score_details o
            where o.event_id = d.event_id and o.distance = d.distance
              and o.class_name = d.class_name and o.target_type = d.target_type
        ) f on true
        where d.wasra = v_wasra
      ), '[]'::jsonb));
end;
$$;


-- ------------------------------------------------- admin: load history from Access

-- p_rows: [{weid, detail, score, inners?, class_name?, distance?}] from the
-- Access ScoreT + WeeklyEntryT exports. Matched by WEID. Fills in a missing
-- class / distance on the (backfilled) entry. Never overwrites a score that
-- was saved from Meyton or typed into the app. p_apply = false only reports.
create or replace function public.load_history_scores(p_rows jsonb, p_apply boolean default false)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_role text := public.current_staff_role();
    v_total integer;
    v_matched integer;
    v_new integer;
    v_changed integer;
    v_kept integer;
    v_unmatched jsonb;
begin
    if v_role is null or v_role <> 'admin' then
        return jsonb_build_object('outcome', 'not_authorised', 'message', 'Only an administrator may load score history.');
    end if;
    if p_rows is null or jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) = 0 then
        return jsonb_build_object('outcome', 'invalid_request', 'message', 'No scores were supplied.');
    end if;
    if jsonb_array_length(p_rows) > 5000 then
        return jsonb_build_object('outcome', 'invalid_request', 'message', 'Send at most 5000 rows at a time.');
    end if;

    drop table if exists pg_temp._h;
    create temp table _h on commit drop as
    select distinct on (weid, detail) *
    from (
        select (x ->> 'weid')::integer as weid,
               (x ->> 'detail')::smallint as detail,
               round((x ->> 'score')::numeric, 2) as score,
               nullif(x ->> 'inners', '')::integer as inners,
               nullif(x ->> 'class_name', '') as class_name,
               nullif(lower(x ->> 'distance'), '') as distance
        from jsonb_array_elements(p_rows) x
    ) r
    where weid is not null and detail between 1 and 4 and score is not null and score >= 0 and score <= 1000
    order by weid, detail, score desc;

    alter table pg_temp._h add column entry_id bigint, add column event_id bigint, add column existing_source text, add column existing_score numeric;
    update pg_temp._h h set entry_id = we.id, event_id = we.event_id
    from public.weekly_entries we where we.weid = h.weid;
    update pg_temp._h h set existing_source = s.source, existing_score = s.score
    from public.scores s where s.weekly_entry_id = h.entry_id and s.detail = h.detail;

    select count(*) into v_total from pg_temp._h;
    select count(*) into v_matched from pg_temp._h where entry_id is not null;
    select count(*) into v_new from pg_temp._h where entry_id is not null and existing_source is null;
    select count(*) into v_changed from pg_temp._h where existing_source = 'access' and existing_score is distinct from score;
    select count(*) into v_kept from pg_temp._h where existing_source in ('meyton', 'manual');
    select coalesce(jsonb_agg(distinct weid), '[]'::jsonb) into v_unmatched from pg_temp._h where entry_id is null;

    if p_apply then
        update public.weekly_entries we
           set shooting_class_snapshot = coalesce(we.shooting_class_snapshot, h.class_name),
               distance = coalesce(nullif(we.distance, ''), h.distance)
        from (select distinct on (entry_id) entry_id, class_name, distance from pg_temp._h where entry_id is not null order by entry_id) h
        where we.id = h.entry_id and we.class_mapping_id is null
          and (we.shooting_class_snapshot is null or nullif(we.distance, '') is null);

        insert into public.scores(event_id, weekly_entry_id, detail, score, inners, source, entered_by)
        select event_id, entry_id, detail, score, inners, 'access', auth.uid()
        from pg_temp._h where entry_id is not null
        on conflict (weekly_entry_id, detail) do update
           set score = excluded.score, inners = excluded.inners, updated_at = now(), entered_by = excluded.entered_by
         where public.scores.source = 'access'
           and (public.scores.score is distinct from excluded.score or public.scores.inners is distinct from excluded.inners);
    end if;

    return jsonb_build_object('outcome', case when p_apply then 'loaded' else 'preview' end,
        'rows', v_total, 'matched', v_matched, 'new', v_new, 'changed', v_changed,
        'kept_app_scores', v_kept, 'unmatched_weids', v_unmatched);
end;
$$;

-- ------------------------------------------------- club averages by month

-- Average score per month for each distance, class and target type.
create or replace function public.club_monthly_averages()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
    if auth.uid() is null then
        return jsonb_build_object('outcome', 'not_signed_in');
    end if;
    return jsonb_build_object('outcome', 'ok', 'rows', coalesce((
        select jsonb_agg(jsonb_build_object('month', m, 'distance', distance, 'class_name', class_name,
                   'target_type', target_type, 'avg', avg_score, 'best', best, 'scores', n, 'shooters', shooters)
               order by m, distance, class_name)
        from (
            select to_char(date_trunc('month', event_date), 'YYYY-MM') as m, distance, class_name, target_type,
                   round(avg(score), 2) as avg_score, max(score) as best, count(*) as n, count(distinct wasra) as shooters
            from public.score_details
            group by 1, 2, 3, 4
        ) x
    ), '[]'::jsonb));
end;
$$;

-- ---------------------------------------------------------------- grants

revoke all on function public.score_class_name(integer, text) from public, anon;
revoke all on function public.event_score_sheet(bigint) from public, anon;
revoke all on function public.save_event_scores(bigint, jsonb, text) from public, anon;
revoke all on function public.delete_event_score(bigint, bigint, integer) from public, anon;
revoke all on function public.score_events() from public, anon;
revoke all on function public.weekly_results(bigint) from public, anon;
revoke all on function public.season_standings(integer) from public, anon;
revoke all on function public.my_scores() from public, anon;
revoke all on function public.load_history_scores(jsonb, boolean) from public, anon;
revoke all on function public.club_monthly_averages() from public, anon;

grant execute on function public.event_score_sheet(bigint) to authenticated;
grant execute on function public.save_event_scores(bigint, jsonb, text) to authenticated;
grant execute on function public.delete_event_score(bigint, bigint, integer) to authenticated;
grant execute on function public.score_events() to authenticated;
grant execute on function public.weekly_results(bigint) to authenticated;
grant execute on function public.season_standings(integer) to authenticated;
grant execute on function public.my_scores() to authenticated;
grant execute on function public.load_history_scores(jsonb, boolean) to authenticated;
grant execute on function public.club_monthly_averages() to authenticated;
