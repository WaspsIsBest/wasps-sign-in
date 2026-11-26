"use client";
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import MonthlyChart, { type Series } from "@/components/MonthlyChart";

type Score = {
  event_date: string; distance: string; class_name: string; target_type: string; eligible: boolean;
  detail: number; score: number; inners: number | null; field_avg: number | null; field_best: number | null; field_n: number; place: number;
};
type Season = { season: number; starts_on: string; ends_on: string; best_50m: number; best_90m: number };
type Standing = { class: string; rank: number; wasra: number; name: string; counted: number; total: number; scores: number[] };
type Monthly = { month: string; distance: string; class_name: string; target_type: string; avg: number };

const td = { padding: "5px 8px", borderBottom: "1px solid #2f2f2f" };
const th = { textAlign: "left" as const, padding: "6px 8px", borderBottom: "2px solid #6b5600" };
const ordinal = (n: number) => `${n}${n % 100 >= 11 && n % 100 <= 13 ? "th" : ["th", "st", "nd", "rd"][n % 10] ?? "th"}`;
const fmt = (n: number) => (Math.round(n * 100) / 100).toFixed(2).replace(/\.00$/, "");
const pretty = (iso: string) => {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString("en-AU", { day: "numeric", month: "short", year: "numeric" });
};

function stats(list: Score[]) {
  const v = list.map((s) => Number(s.score));
  const avg = v.reduce((a, b) => a + b, 0) / v.length;
  const sd = Math.sqrt(v.reduce((a, b) => a + (b - avg) ** 2, 0) / v.length);
  const best = list.reduce((b, s) => (Number(s.score) > Number(b.score) ? s : b), list[0]);
  const last5 = v.slice(-5);
  return { n: v.length, avg, sd, best, last5: last5.reduce((a, b) => a + b, 0) / last5.length };
}

export default function MyScoresApp() {
  const supabase = useMemo(() => createClient(), []);
  const [state, setState] = useState<"loading" | "ready" | "not_linked" | "error">("loading");
  const [scores, setScores] = useState<Score[]>([]);
  const [wasra, setWasra] = useState<number | null>(null);
  const [seasons, setSeasons] = useState<Season[]>([]);
  const [club, setClub] = useState<Monthly[]>([]);
  const [standing, setStanding] = useState<Record<string, Standing[]>>({});
  const [view, setView] = useState("50m|E");

  useEffect(() => {
    async function init() {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { window.location.href = "/member"; return; }
      const { data, error } = await supabase.rpc("my_scores");
      if (error) { setState("error"); return; }
      if (data?.outcome === "not_linked") { setState("not_linked"); return; }
      if (data?.outcome !== "ok") { setState("error"); return; }
      const list = data.scores as Score[];
      setScores(list);
      setWasra(data.wasra);
      setSeasons(data.seasons as Season[]);
      const kinds = [...new Set(list.map((s) => `${s.distance}|${s.target_type}`))];
      if (kinds.length && !kinds.includes("50m|E")) setView(kinds[0]);
      setState("ready");

      const { data: m } = await supabase.rpc("club_monthly_averages");
      if (m?.outcome === "ok") setClub(m.rows as Monthly[]);
      const latest = (data.seasons as Season[]).slice(-1)[0];
      if (latest) {
        const { data: st } = await supabase.rpc("season_standings", { p_season: latest.season });
        if (st?.outcome === "ok") setStanding({ "50m": st.standings_50m, "90m": st.standings_90m });
      }
    }
    void init();
  }, [supabase]);

  if (state === "loading") return <main className="main">Loading your scores...</main>;
  if (state === "error") return <main className="main"><p className="error-text">Your scores could not be loaded.</p></main>;
  if (state === "not_linked") return <main className="main"><p>Link your membership first on the <Link href="/member">member page</Link>.</p></main>;
  if (scores.length === 0) return <main className="main"><h1>My scores</h1><p className="muted">No scores have been recorded for you yet.</p></main>;

  const kinds = [...new Set(scores.map((s) => `${s.distance}|${s.target_type}`))].sort();
  const [dist, tt] = view.split("|");
  const mine = scores.filter((s) => s.distance === dist && s.target_type === tt);
  const classes = [...new Set(mine.map((s) => s.class_name))].sort();

  const series: Series[] = [];
  for (const c of classes) {
    const byMonth = new Map<string, number[]>();
    for (const s of mine.filter((x) => x.class_name === c)) {
      const m = s.event_date.slice(0, 7);
      byMonth.set(m, [...(byMonth.get(m) ?? []), Number(s.score)]);
    }
    series.push({ name: c, points: Object.fromEntries([...byMonth].map(([m, v]) => [m, v.reduce((a, b) => a + b, 0) / v.length])) });
  }
  const myMonths = new Set(series.flatMap((s) => Object.keys(s.points)));
  for (const c of classes) {
    const pts = club.filter((m) => m.distance === dist && m.target_type === tt && m.class_name === c && myMonths.has(m.month));
    if (pts.length) series.push({ name: `Club ${c}`, dashed: true, points: Object.fromEntries(pts.map((m) => [m.month, Number(m.avg)])) });
  }

  const season = seasons.slice(-1)[0];
  const mySt = (standing[dist] ?? []).filter((r) => r.wasra === wasra);

  return (
    <main className="main">
      <h1>My scores</h1>
      <div className="toolbar">
        {kinds.map((k) => {
          const [d, t] = k.split("|");
          return <button key={k} className={view === k ? "primary" : "secondary"} onClick={() => setView(k)}>{d} {t === "E" ? "electronic" : "paper"}</button>;
        })}
      </div>

      {classes.map((c) => {
        const s = stats(mine.filter((x) => x.class_name === c));
        return (
          <section key={c} className="result info">
            <div className="result-title">{dist} {c}</div>
            <div className="stats">
              <div className="stat"><b>{fmt(s.avg)}</b><span>Average ({s.n} scores)</span></div>
              <div className="stat"><b>{fmt(s.last5)}</b><span>Last 5 average</span></div>
              <div className="stat"><b>{fmt(Number(s.best.score))}</b><span>Best · {pretty(s.best.event_date)}</span></div>
            </div>
            <p className="muted" style={{ margin: 0 }}>Consistency: scores typically within ±{fmt(s.sd)} of your average.
              {s.last5 > s.avg ? " Your recent form is above your average." : s.last5 < s.avg ? " Your recent form is below your average." : ""}</p>
          </section>
        );
      })}

      <MonthlyChart title={`My monthly average, ${dist}`} series={series} />
      <p className="muted">Solid lines are your average for the month; dashed lines are the club average in the same class.</p>

      {season && (
        <section className="result info">
          <div className="result-title">{season.season} championship, {dist}</div>
          {mySt.length === 0 ? (
            <p className="muted">No counting scores yet. The championship runs {pretty(season.starts_on)} to {pretty(season.ends_on)}
              {" "}(best {dist === "50m" ? season.best_50m : season.best_90m} scores count).</p>
          ) : mySt.map((r) => {
            const field = (standing[dist] ?? []).filter((x) => x.class === r.class);
            const ahead = field.filter((x) => x.rank < r.rank).sort((a, b) => b.rank - a.rank)[0];
            const need = dist === "50m" ? season.best_50m : season.best_90m;
            return (
              <p key={r.class}><strong>{r.class}: {ordinal(r.rank)} of {field.length}</strong>, total {fmt(r.total)} from {r.counted} of {need} counting scores.
                {r.counted >= need ? ` Your lowest counting score is ${fmt(r.scores[r.scores.length - 1])}; beat it to improve your total.` : ` ${need - r.counted} more score(s) will count in full.`}
                {ahead ? ` ${fmt(ahead.total - r.total)} behind ${ahead.name}.` : ""}</p>
            );
          })}
          <Link href="/championship">Full championship table</Link>
        </section>
      )}

      <h2>Recent scores</h2>
      <div style={{ overflowX: "auto" }}>
        <table style={{ borderCollapse: "collapse", width: "100%" }}>
          <thead><tr><th style={th}>Date</th><th style={th}>Class</th><th style={th}>D</th><th style={th}>Score</th><th style={th}>Place</th><th style={th}>Class avg</th></tr></thead>
          <tbody>{[...mine].reverse().slice(0, 30).map((s, i) => (
            <tr key={i}>
              <td style={td}>{pretty(s.event_date)}</td><td style={td}>{s.class_name}</td><td style={td}>{s.detail}</td>
              <td style={td}><strong>{fmt(Number(s.score))}</strong>{s.inners != null ? ` (${s.inners})` : ""}</td>
              <td style={td}>{s.place} of {s.field_n}</td><td style={td}>{s.field_avg != null ? fmt(Number(s.field_avg)) : ""}</td>
            </tr>
          ))}</tbody>
        </table>
      </div>
    </main>
  );
}
