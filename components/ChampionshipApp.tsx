"use client";
import { useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";

const SEASON = 2026;
const CLASSES = ["Benchrest", "F-Open", "Modified", "Sporter"];
type View = "50m" | "dual" | "90m";

type Row50 = { class: string; rank: number; wasra: number; name: string; counted: number; total: number; scores: number[] };
type Row90 = Row50 & { inners: number };
type RowDual = {
  class: string; rank: number; wasra: number; name: string;
  n50: number; n90: number; total50: number; total90: number; inners: number; total: number;
};
type Standings = {
  outcome: string;
  last_night: string | null;
  loaded_at: string | null;
  standings_50m: Row50[];
  standings_90m: Row90[];
  standings_dual: RowDual[];
};

function pretty(iso: string | null) {
  if (!iso) return "";
  const [y, m, d] = iso.slice(0, 10).split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString("en-AU", { day: "numeric", month: "long", year: "numeric" });
}

const th = { textAlign: "left" as const, padding: "6px 10px", borderBottom: "2px solid #0b2540" };
const td = { padding: "6px 10px", borderBottom: "1px solid #d5e2ef" };

export default function ChampionshipApp() {
  const supabase = useMemo(() => createClient(), []);
  const [state, setState] = useState<"loading" | "error" | "ready">("loading");
  const [data, setData] = useState<Standings | null>(null);
  const [cls, setCls] = useState("Benchrest");
  const [view, setView] = useState<View>("50m");

  useEffect(() => {
    async function load() {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) {
        window.location.href = "/login";
        return;
      }
      const { data: res, error } = await supabase.rpc("championship_standings", { p_season: SEASON });
      if (error || res?.outcome !== "ok") {
        setState("error");
        return;
      }
      setData(res as Standings);
      setState("ready");
    }
    void load();
  }, [supabase]);

  if (state === "loading") return <main className="main">Loading...</main>;
  if (state === "error" || !data) {
    return (
      <main className="main">
        <div className="result error">
          <strong>Sorry</strong>
          <p>The championship could not be loaded. Please sign in and try again.</p>
        </div>
      </main>
    );
  }

  const r50 = data.standings_50m.filter((r) => r.class === cls);
  const r90 = data.standings_90m.filter((r) => r.class === cls);
  const rd = data.standings_dual.filter((r) => r.class === cls);
  const tab = (active: boolean) => ({
    padding: "8px 14px",
    marginRight: 8,
    marginBottom: 8,
    borderRadius: 8,
    border: "1px solid #0b5cad",
    background: active ? "#0b5cad" : "#fff",
    color: active ? "#fff" : "#0b5cad",
    font: "inherit",
    cursor: "pointer",
  });

  return (
    <main className="main">
      <h1>{SEASON} Club Championship</h1>
      <p className="muted">
        Scores up to {pretty(data.last_night)}. Provisional until the end of the
        season. 50m: your best 10 scores (maximum 2,180). 90m: your best 5
        (maximum 1,000). Dual range: both added.
      </p>

      <div>
        {CLASSES.map((c) => (
          <button key={c} type="button" style={tab(cls === c)} onClick={() => setCls(c)}>
            {c}
          </button>
        ))}
      </div>
      <div>
        {(["50m", "dual", "90m"] as View[]).map((v) => (
          <button key={v} type="button" style={tab(view === v)} onClick={() => setView(v)}>
            {v === "50m" ? "50m championship" : v === "dual" ? "Dual range" : "90m"}
          </button>
        ))}
      </div>

      <div style={{ overflowX: "auto" }}>
        {view === "50m" ? (
          <table style={{ borderCollapse: "collapse", width: "100%" }}>
            <thead>
              <tr>
                <th style={th}>Rank</th>
                <th style={th}>Member</th>
                <th style={th}>Scores</th>
                <th style={th}>Total</th>
                <th style={th}>Best scores</th>
              </tr>
            </thead>
            <tbody>
              {r50.map((r) => (
                <tr key={r.wasra}>
                  <td style={td}>{r.rank}</td>
                  <td style={td}>{r.name}</td>
                  <td style={td}>{r.counted}</td>
                  <td style={td}><strong>{r.total.toFixed(1)}</strong></td>
                  <td style={td}>{r.scores.map((s) => s.toFixed(1)).join(", ")}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : null}

        {view === "90m" ? (
          <table style={{ borderCollapse: "collapse", width: "100%" }}>
            <thead>
              <tr>
                <th style={th}>Rank</th>
                <th style={th}>Member</th>
                <th style={th}>Scores</th>
                <th style={th}>Total</th>
                <th style={th}>Inners</th>
                <th style={th}>Best scores</th>
              </tr>
            </thead>
            <tbody>
              {r90.map((r) => (
                <tr key={r.wasra}>
                  <td style={td}>{r.rank}</td>
                  <td style={td}>{r.name}</td>
                  <td style={td}>{r.counted}</td>
                  <td style={td}><strong>{r.total}</strong></td>
                  <td style={td}>{r.inners}</td>
                  <td style={td}>{r.scores.join(", ")}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : null}

        {view === "dual" ? (
          <table style={{ borderCollapse: "collapse", width: "100%" }}>
            <thead>
              <tr>
                <th style={th}>Rank</th>
                <th style={th}>Member</th>
                <th style={th}>50m</th>
                <th style={th}>90m</th>
                <th style={th}>Inners</th>
                <th style={th}>Total</th>
              </tr>
            </thead>
            <tbody>
              {rd.map((r) => (
                <tr key={r.wasra}>
                  <td style={td}>{r.rank}</td>
                  <td style={td}>{r.name}</td>
                  <td style={td}>{r.total50.toFixed(1)} ({r.n50})</td>
                  <td style={td}>{r.total90} ({r.n90})</td>
                  <td style={td}>{r.inners}</td>
                  <td style={td}><strong>{r.total.toFixed(1)}</strong></td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : null}

        {(view === "50m" ? r50 : view === "90m" ? r90 : rd).length === 0 ? (
          <p className="muted">No results in this class yet.</p>
        ) : null}
      </div>
    </main>
  );
}
