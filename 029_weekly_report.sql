-- WASPS Weekly Sign-In
-- 029: Weekly results with what the printed report needs.
-- Adds the championship flag (Y/N) and every score high to low (for breaking
-- ties on best score) to weekly_results. Run after 028. Safe to run more than once.
--
-- Championship Y = the entry is marked for the championship, and for 50m it was
-- shot on an electronic target (50m paper scores do not count).

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
                   (d.eligible and (d.distance <> '50m' or d.target_type = 'E')) as championship,
                   jsonb_object_agg(d.detail::text, jsonb_build_object('score', d.score, 'inners', d.inners)) as details,
                   array_agg(d.score order by d.score desc, coalesce(d.inners, 0) desc) as ordered,
                   max(d.score) as best,
                   sum(d.score) as total,
                   count(*) as shot
            from public.score_details d
            where d.event_id = p_event_id
            group by d.weekly_entry_id, d.wasra, d.name, d.distance, d.class_name, d.target_type, d.position, d.eligible
        ) r
      ), '[]'::jsonb));
end;
$$;

revoke all on function public.weekly_results(bigint) from public, anon;
grant execute on function public.weekly_results(bigint) to authenticated;
