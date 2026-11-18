-- WASPS Weekly Sign-In
-- 018: Club championship scores and standings.
-- Scores are loaded (as a copy) from the Access ScoreT / WeeklyEntryT exports.
-- Standings follow the 2026 supplementary regulations:
--   50m: best 10 scores per member per class; 90m: best 5; dual range: both added.

create table if not exists public.championship_scores (
    id bigserial primary key,
    season integer not null,
    wasra_number integer not null,
    member_name text,
    class_name text not null,
    distance text not null check (distance in ('50m', '90m')),
    night date not null,
    detail integer not null check (detail between 1 and 4),
    score numeric(7, 2) not null,
    inners integer,
    source_scid integer,
    weid integer,
    loaded_at timestamptz not null default now(),
    unique (season, wasra_number, class_name, distance, night, detail)
);
create index if not exists championship_scores_season_idx
    on public.championship_scores (season, distance, class_name);

create table if not exists public.championship_loads (
    id bigserial primary key,
    season integer not null,
    loaded_at timestamptz not null default now(),
    loaded_by uuid,
    row_count integer not null,
    last_night date,
    note text
);

alter table public.championship_scores enable row level security;
alter table public.championship_loads enable row level security;
revoke all on public.championship_scores from public, anon, authenticated;
revoke all on public.championship_loads from public, anon, authenticated;

-- Replace one season's scores with a freshly loaded copy (admin/organiser only).
create or replace function public.load_championship_scores(p_season integer, p_rows jsonb, p_note text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_role text := public.current_staff_role();
    v_count integer;
    v_last date;
begin
    if v_role is null or v_role not in ('admin', 'organiser') then
        return jsonb_build_object('outcome', 'not_authorised', 'message', 'Only an administrator or organiser may load scores.');
    end if;
    if p_season is null or p_season < 2000 or p_season > 2100 then
        return jsonb_build_object('outcome', 'invalid_request', 'message', 'Invalid season.');
    end if;
    if p_rows is null or jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) = 0 then
        return jsonb_build_object('outcome', 'invalid_request', 'message', 'No scores were supplied.');
    end if;
    if jsonb_array_length(p_rows) > 20000 then
        return jsonb_build_object('outcome', 'import_too_large', 'message', 'Too many rows.');
    end if;

    delete from public.championship_scores where season = p_season;

    insert into public.championship_scores(season, wasra_number, member_name, class_name, distance, night, detail, score, inners, source_scid, weid)
    select p_season,
           (x ->> 'wasra')::integer,
           nullif(x ->> 'name', ''),
           x ->> 'class_name',
           x ->> 'distance',
           (x ->> 'night')::date,
           (x ->> 'detail')::integer,
           (x ->> 'score')::numeric,
           nullif(x ->> 'inners', '')::integer,
           nullif(x ->> 'scid', '')::integer,
           nullif(x ->> 'weid', '')::integer
    from jsonb_array_elements(p_rows) x
    on conflict do nothing;

    select count(*), max(night) into v_count, v_last from public.championship_scores where season = p_season;

    insert into public.championship_loads(season, loaded_by, row_count, last_night, note)
    values (p_season, auth.uid(), v_count, v_last, p_note);

    return jsonb_build_object('outcome', 'loaded', 'rows', v_count, 'last_night', v_last);
end;
$$;

-- Standings for the season, for any signed-in user.
create or replace function public.championship_standings(p_season integer)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
    v_result jsonb;
begin
    if auth.uid() is null then
        return jsonb_build_object('outcome', 'not_signed_in');
    end if;

    with named as (
        select s.*,
               coalesce(
                   nullif(trim(concat_ws(' ', coalesce(nullif(m.preferred_name, ''), m.first_name), m.surname)), ''),
                   s.member_name, 'Member ' || s.wasra_number) as display_name
        from public.championship_scores s
        left join lateral (
            select first_name, surname, preferred_name from public.members
            where wasra_number = s.wasra_number order by is_active desc nulls last, id limit 1
        ) m on true
        where s.season = p_season
    ),
    ranked as (
        select n.*, row_number() over (
            partition by wasra_number, class_name, distance
            order by score desc, night, detail) as pos
        from named n
    ),
    best as (
        select wasra_number, class_name, distance, max(display_name) as display_name,
               count(*) as counted, sum(score) as total, coalesce(sum(inners), 0) as inners,
               array_agg(score order by score desc, night) as scores
        from ranked
        where (distance = '50m' and pos <= 10) or (distance = '90m' and pos <= 5)
        group by wasra_number, class_name, distance
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
        'last_night', (select max(night) from public.championship_scores where season = p_season),
        'loaded_at', (select max(loaded_at) from public.championship_loads where season = p_season),
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

revoke all on function public.load_championship_scores(integer, jsonb, text) from public, anon;
revoke all on function public.championship_standings(integer) from public, anon;
grant execute on function public.load_championship_scores(integer, jsonb, text) to authenticated;
grant execute on function public.championship_standings(integer) to authenticated;
