"use client";
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { calculate, type CalcResult } from "@/lib/championship/calc";

const SEASON = 2026;

export default function ScoreLoaderApp() {
  const supabase = useMemo(() => createClient(), []);
  const [allowed, setAllowed] = useState<boolean | null>(null);
  const [weekly, setWeekly] = useState<ArrayBuffer | null>(null);
  const [scores, setScores] = useState<ArrayBuffer | null>(null);
  const [result, setResult] = useState<CalcResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState("");

  useEffect(() => {
    async function init() {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) {
        window.location.href = "/login";
        return;
      }
      const { data } = await supabase
        .from("user_profiles")
        .select("role,is_active")
        .eq("user_id", user.id)
        .maybeSingle();
      setAllowed(
        Boolean(data?.is_active && (data.role === "admin" || data.role === "organiser")),
      );
    }
    void init();
  }, [supabase]);

  async function pick(setter: (b: ArrayBuffer | null) => void, file?: File) {
    setResult(null);
    setDone("");
    setError("");
    setter(file ? await file.arrayBuffer() : null);
  }

  function check() {
    if (!weekly || !scores) return;
    setError("");
    setDone("");
    try {
      setResult(calculate(weekly, scores));
    } catch {
      setError("The files could not be read. Use the Access exports of WeeklyEntryT and ScoreT (.xlsx).");
    }
  }

  async function load() {
    if (!result || busy) return;
    setBusy(true);
    setError("");
    try {
      const { data, error: rpcError } = await supabase.rpc("load_championship_scores", {
        p_season: SEASON,
        p_rows: result.rows,
        p_note: `Loaded from Access exports, scores to ${result.lastNight ?? "n/a"}`,
      });
      if (rpcError) {
        setError(`The load failed: ${rpcError.message}. Run 018_championship.sql in Supabase first.`);
        return;
      }
      if (data?.outcome !== "loaded") {
        setError(data?.message ?? "The load was refused.");
        return;
      }
      setDone(`Loaded ${data.rows} scores, up to ${data.last_night}.`);
    } finally {
      setBusy(false);
    }
  }

  if (allowed === null) return <main className="main">Checking permissions...</main>;
  if (!allowed) {
    return (
      <main className="main">
        <h2>Not authorised</h2>
        <p>Only administrators and organisers can load scores.</p>
        <Link href="/sign-in">Return to sign-in</Link>
      </main>
    );
  }

  const counts: Record<string, number> = {};
  for (const r of result?.rows ?? []) {
    const k = `${r.distance} ${r.class_name}`;
    counts[k] = (counts[k] ?? 0) + 1;
  }

  return (
    <main className="main">
      <h1>Load championship scores</h1>
      <p className="muted">
        Copies the scores from Access into Supabase for the {SEASON} championship.
        Access stays the master. Loading again replaces the {SEASON} copy, so
        you can reload after each batch of scores.
      </p>

      <section className="result info">
        <label className="field">
          <span>WeeklyEntryT export (.xlsx)</span>
          <input type="file" accept=".xlsx,.xls" onChange={(e) => void pick(setWeekly, e.target.files?.[0])} />
        </label>
        <label className="field">
          <span>ScoreT export (.xlsx)</span>
          <input type="file" accept=".xlsx,.xls" onChange={(e) => void pick(setScores, e.target.files?.[0])} />
        </label>
        <div className="actions">
          <button className="primary" type="button" disabled={!weekly || !scores} onClick={check}>
            Check the files (saves nothing)
          </button>
        </div>
      </section>

      {error !== "" ? (
        <div className="result error">
          <strong>Problem</strong>
          <p>{error}</p>
        </div>
      ) : null}
      {done !== "" ? (
        <div className="result success">
          <strong>Done</strong>
          <p>{done}</p>
          <Link href="/championship">Open the championship page</Link>
        </div>
      ) : null}

      {result ? (
        <section className="result info">
          <h2>Preview</h2>
          <p>
            {result.scoreRowsRead} score rows read. <strong>{result.rows.length}</strong> scores
            will count, up to {result.lastNight ?? "n/a"}.
          </p>
          <table style={{ borderCollapse: "collapse" }}>
            <tbody>
              {Object.entries(counts)
                .sort()
                .map(([k, v]) => (
                  <tr key={k}>
                    <td style={{ padding: "3px 14px 3px 0" }}>{k}</td>
                    <td>
                      <strong>{v}</strong>
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>

          <h3>Not counted</h3>
          <table style={{ borderCollapse: "collapse" }}>
            <tbody>
              {Object.entries(result.notCounted).map(([k, v]) => (
                <tr key={k}>
                  <td style={{ padding: "3px 14px 3px 0" }}>{k}</td>
                  <td>{v}</td>
                </tr>
              ))}
              <tr>
                <td style={{ padding: "3px 14px 3px 0" }}>Could not be matched to an entry</td>
                <td>{result.unplaced.length}</td>
              </tr>
            </tbody>
          </table>

          {result.unplaced.length > 0 ? (
            <>
              <h3>Scores that could not be matched</h3>
              <table style={{ borderCollapse: "collapse", width: "100%" }}>
                <thead>
                  <tr>
                    <th align="left">Score ID</th>
                    <th align="left">Date</th>
                    <th align="left">Detail</th>
                    <th align="left">WASRA</th>
                    <th align="left">WEID</th>
                    <th align="left">Score</th>
                  </tr>
                </thead>
                <tbody>
                  {result.unplaced.slice(0, 100).map((u) => (
                    <tr key={`${u.scid}-${u.detail}`}>
                      <td style={{ padding: "2px 8px 2px 0" }}>{u.scid}</td>
                      <td style={{ padding: "2px 8px 2px 0" }}>{u.date ?? ""}</td>
                      <td style={{ padding: "2px 8px 2px 0" }}>{u.detail}</td>
                      <td style={{ padding: "2px 8px 2px 0" }}>{u.wasra ?? ""}</td>
                      <td style={{ padding: "2px 8px 2px 0" }}>{u.weid ?? ""}</td>
                      <td style={{ padding: "2px 0" }}>{u.score ?? ""}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          ) : null}

          <div className="actions">
            <button className="primary" type="button" disabled={busy || result.rows.length === 0} onClick={() => void load()}>
              {busy ? "Loading..." : `Load ${result.rows.length} scores into Supabase`}
            </button>
          </div>
        </section>
      ) : null}
    </main>
  );
}
