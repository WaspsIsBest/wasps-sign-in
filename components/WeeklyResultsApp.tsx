"use client";
import { useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { longDate } from "@/lib/event-allocation/outputs";
import MonthlyChart, { type Series } from "@/components/MonthlyChart";
import { rankResults, weeklyResultsPdf } from "@/lib/scores/weekly-report";

type Ev = { id: number; event_date: string; scores: number };
type Row = {
  weekly_entry_id: number; wasra: number | null; name: string; distance: string; class_name: string;
  target_type: string; position: string | null; details: Record<string, { score: number; inners: number | null }>;
  best: number; total: number; shot: number; championship?: boolean; ordered?: number[];
};
type Monthly = { month: string; distance: string; class_name: string; target_type: string; avg: number; best: number; scores: number; shooters: number };

const th = { textAlign: "left" as const, padding: "6px 8px", borderBottom: "2px solid #6b5600" };
const td = { padding: "5px 8px", borderBottom: "1px solid #2f2f2f" };

export default function WeeklyResultsApp() {
  const supabase = useMemo(() => createClient(), []);
  const [view, setView] = useState<"night" | "trends">("night");
  const [events, setEvents] = useState<Ev[]>([]);
  const [eventId, setEventId] = useState<number | null>(null);
  const [rows, setRows] = useState<Row[]>([]);
  const [monthly, setMonthly] = useState<Monthly[]>([]);
  const [dist, setDist] = useState("50m");
  const [tt, setTt] = useState("E");
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const [eventDate, setEventDate] = useState("");
  const [printing, setPrinting] = useState(false);
  const [pickError, setPickError] = useState("");

  useEffect(() => {
    async function init() {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { window.location.href = "/member"; return; }
      const { data, error } = await supabase.rpc("score_events");
      if (error || data?.outcome !== "ok") { setState("error"); return; }
      const evs = data.events as Ev[];
      setEvents(evs);
      const fromUrl = Number(new URLSearchParams(window.location.search).get("event"));
      setEventId(evs.find((e) => e.id === fromUrl)?.id ?? evs[0]?.id ?? null);
      setState("ready");
    }
    void init();
  }, [supabase]);

  useEffect(() => {
    if (eventId === null) return;
    void supabase.rpc("weekly_results", { p_event_id: eventId }).then(({ data }) => {
      if (data?.outcome === "ok") { setRows(data.rows as Row[]); setEventDate(data.event_date); }
    });
  }, [supabase, eventId]);

  useEffect(() => {
    if (view !== "trends" || monthly.length) return;
    void supabase.rpc("club_monthly_averages").then(({ data }) => {
      if (data?.outcome === "ok") setMonthly(data.rows as Monthly[]);
    });
  }, [supabase, view, monthly.length]);

  if (state === "loading") return <main className="main">Loading results...</main>;
  if (state === "error") return <main className="main"><p className="error-text">Results could not be loaded.</p></main>;

  const groups = rankResults(rows);

  const trend = monthly.filter((m) => m.distance === dist && m.target_type === tt);
  const series: Series[] = [...new Set(trend.map((m) => m.class_name))].sort().map((c) => ({
    name: c, points: Object.fromEntries(trend.filter((m) => m.class_name === c).map((m) => [m.month, Number(m.avg)])),
  }));

  return (
    <main className="main">
      <h1>Results</h1>
      <div className="toolbar">
        <button className={view === "night" ? "primary" : "secondary"} onClick={() => setView("night")}>Weekly results</button>
        <button className={view === "trends" ? "primary" : "secondary"} onClick={() => setView("trends")}>Club averages by month</button>
      </div>

      {view === "night" && (
        <>
          {events.length === 0 ? <p className="muted">No scores have been saved yet.</p> : (
            <div style={{ display: "grid", gridTemplateColumns: "1fr auto", gap: 10, alignItems: "end" }}>
              <label className="field" style={{ margin: "14px 0 6px" }}><span>Night</span>
                <select value={eventId ?? ""} onChange={(e) => { setPickError(""); setEventId(Number(e.target.value)); }}>
                  {events.map((e) => <option key={e.id} value={e.id}>{longDate(e.event_date)}</option>)}
                </select>
              </label>
              <label className="field" style={{ margin: "14px 0 6px" }}><span>Pick date</span>
                <input type="date" value={eventDate} onChange={(e) => {
                  const found = events.find((ev) => ev.event_date === e.target.value);
                  if (found) { setPickError(""); setEventId(found.id); }
                  else setPickError(`No scores saved for ${e.target.value ? longDate(e.target.value) : "that date"}.`);
                }} />
              </label>
            </div>
          )}
          {pickError && <p className="error-text">{pickError}</p>}
          {rows.length > 0 && (
            <div className="actions" style={{ marginTop: 0 }}>
              <button className="primary" disabled={printing} onClick={async () => {
                setPrinting(true);
                try { await weeklyResultsPdf(eventDate, rows); } finally { setPrinting(false); }
              }}>{printing ? "Building..." : "Download results PDF"}</button>
            </div>
          )}
          {groups.map((g) => {
            const list = g.rows;
            return (
              <section key={g.title} className="result info" style={{ overflowX: "auto" }}>
                <div className="result-title">{g.title}</div>
                <table style={{ borderCollapse: "collapse", width: "100%", marginTop: 8 }}>
                  <thead><tr><th style={th}>Place</th><th style={th}>Competitor</th>{[1, 2, 3, 4].map((d) => <th key={d} style={th}>{d}</th>)}<th style={th}>Champ</th><th style={th}>Score</th></tr></thead>
                  <tbody>{list.map((r) => (
                    <tr key={r.weekly_entry_id}>
                      <td style={td}>{r.tied ? "=" : ""}{r.place}</td>
                      <td style={td}>{r.name}</td>
                      {[1, 2, 3, 4].map((d) => {
                        const s = r.details[String(d)];
                        return <td key={d} style={td}>{s ? `${Number(s.score)}${s.inners != null ? ` (${s.inners})` : ""}` : "0"}</td>;
                      })}
                      <td style={td}>{r.championship === false ? "N" : "Y"}</td>
                      <td style={td}><strong>{Number(r.best)}</strong></td>
                    </tr>
                  ))}</tbody>
                </table>
              </section>
            );
          })}
          {rows.length > 0 && <p className="muted">Placed by best score in class; a tie goes to the next best score. 90m inners shown in brackets. All results are provisional.</p>}
        </>
      )}

      {view === "trends" && (
        <section>
          <div className="toolbar" style={{ margin: "10px 0" }}>
            {["50m", "90m"].map((d) => <button key={d} className={dist === d ? "primary" : "secondary"} onClick={() => setDist(d)}>{d}</button>)}
            {[["E", "Electronic"], ["P", "Paper"]].map(([v, l]) => <button key={v} className={tt === v ? "primary" : "secondary"} onClick={() => setTt(v)}>{l}</button>)}
          </div>
          <MonthlyChart title={`Average score by class, ${dist} ${tt === "E" ? "electronic" : "paper"}`} series={series} />
          <p className="muted">Each point is the average of every score shot in that class that month.</p>
        </section>
      )}
    </main>
  );
}
