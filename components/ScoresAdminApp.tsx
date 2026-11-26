"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { longDate } from "@/lib/event-allocation/outputs";
import { matchToNight, readMeyton, type MatchResult, type SheetEntry } from "@/lib/scores/meyton";
import { readHistory, type HistoryResult } from "@/lib/scores/history";

type EventItem = { id: number; event_date: string; entries: number };
type Tab = "manual" | "meyton" | "history";

const th = { textAlign: "left" as const, padding: "6px 8px", borderBottom: "2px solid #6b5600", whiteSpace: "nowrap" as const };
const td = { padding: "5px 8px", borderBottom: "1px solid #2f2f2f" };
const inputStyle = { width: 82, padding: "8px", background: "#000", color: "#fff", border: "1px solid #5a5a5a", borderRadius: 8 };

export default function ScoresAdminApp() {
  const supabase = useMemo(() => createClient(), []);
  const [role, setRole] = useState<string | null | undefined>(undefined);
  const [tab, setTab] = useState<Tab>("manual");
  const [events, setEvents] = useState<EventItem[]>([]);
  const [eventId, setEventId] = useState<number | null>(null);
  const [eventDate, setEventDate] = useState("");
  const [entries, setEntries] = useState<SheetEntry[]>([]);
  const [error, setError] = useState("");
  const [done, setDone] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    async function init() {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { window.location.href = "/login"; return; }
      const { data } = await supabase.from("user_profiles").select("role,is_active").eq("user_id", user.id).maybeSingle();
      const r = data?.is_active ? (data.role as string) : null;
      setRole(r);
      if (r !== "admin" && r !== "organiser") return;
      const { data: ev } = await supabase.rpc("list_recent_events");
      if (ev?.outcome === "ok") {
        setEvents(ev.events as EventItem[]);
        const today = new Date().toISOString().slice(0, 10);
        const past = (ev.events as EventItem[]).find((e) => e.event_date <= today);
        setEventId(past?.id ?? (ev.events as EventItem[])[0]?.id ?? null);
      }
    }
    void init();
  }, [supabase]);

  const loadSheet = useCallback(async () => {
    if (eventId === null) return;
    const { data, error: e } = await supabase.rpc("event_score_sheet", { p_event_id: eventId });
    if (e) { setError(`${e.message}. Run 028_scores.sql in Supabase first.`); return; }
    if (data?.outcome !== "ok") { setError(data?.message ?? "Could not load the night."); return; }
    setEventDate(data.event_date);
    setEntries(data.entries as SheetEntry[]);
  }, [supabase, eventId]);

  useEffect(() => { setError(""); setDone(""); void loadSheet(); }, [loadSheet]);

  async function save(rows: object[], source: "meyton" | "manual") {
    if (eventId === null || rows.length === 0) return false;
    setBusy(true); setError(""); setDone("");
    try {
      const { data, error: e } = await supabase.rpc("save_event_scores", { p_event_id: eventId, p_rows: rows, p_source: source });
      if (e) { setError(e.message); return false; }
      if (data?.outcome !== "saved") { setError(data?.message ?? "The save was refused."); return false; }
      setDone(`Saved: ${data.added} new, ${data.changed} changed, ${data.unchanged} unchanged.`);
      await loadSheet();
      return true;
    } finally { setBusy(false); }
  }

  if (role === undefined) return <main className="main">Checking permissions...</main>;
  if (role !== "admin" && role !== "organiser") {
    return <main className="main"><h2>Not authorised</h2><p>Only administrators and organisers can manage scores.</p><Link href="/sign-in">Return to sign-in</Link></main>;
  }

  const scored = entries.reduce((n, e) => n + Object.keys(e.scores ?? {}).length, 0);

  return (
    <main className="main">
      <h1>Scores</h1>
      <div className="toolbar">
        <button className={tab === "manual" ? "primary" : "secondary"} onClick={() => setTab("manual")}>Enter scores</button>
        <button className={tab === "meyton" ? "primary" : "secondary"} onClick={() => setTab("meyton")}>Import Meyton</button>
        {role === "admin" && <button className={tab === "history" ? "primary" : "secondary"} onClick={() => setTab("history")}>Load Access history</button>}
      </div>

      {tab !== "history" && (
        <label className="field"><span>Night</span>
          <select value={eventId ?? ""} onChange={(e) => setEventId(Number(e.target.value))}>
            {events.map((e) => <option key={e.id} value={e.id}>{longDate(e.event_date)} ({e.entries} entries)</option>)}
          </select>
        </label>
      )}
      {tab !== "history" && eventDate && <p className="muted">{entries.length} entries, {scored} scores saved for this night. <Link href={`/results?event=${eventId}`}>See the results</Link></p>}

      {error && <div className="result error"><strong>Problem</strong><p>{error}</p></div>}
      {done && <div className="result success"><strong>Done</strong><p>{done}</p></div>}

      {tab === "manual" && <ManualEntry entries={entries} busy={busy} onSave={(rows) => save(rows, "manual")}
        onDelete={async (id, d) => {
          if (eventId === null) return;
          await supabase.rpc("delete_event_score", { p_event_id: eventId, p_weekly_entry_id: id, p_detail: d });
          setDone("Score removed."); await loadSheet();
        }} />}
      {tab === "meyton" && <MeytonImport entries={entries} eventDate={eventDate} busy={busy} onSave={(rows) => save(rows, "meyton")} />}
      {tab === "history" && <HistoryLoad />}
    </main>
  );
}

// ------------------------------------------------------------ manual entry

function ManualEntry({ entries, busy, onSave, onDelete }: {
  entries: SheetEntry[]; busy: boolean;
  onSave: (rows: object[]) => Promise<boolean>;
  onDelete: (weeklyEntryId: number, detail: number) => Promise<void>;
}) {
  const [detail, setDetail] = useState(1);
  const [showAll, setShowAll] = useState(false);
  const [only90, setOnly90] = useState(false);
  const [edits, setEdits] = useState<Record<string, { score: string; inners: string }>>({});

  useEffect(() => { setEdits({}); }, [entries]);

  const list = entries
    .filter((e) => showAll || e.bays?.[String(detail)] !== undefined)
    .filter((e) => !only90 || e.distance === "90m")
    .sort((a, b) => (a.bays?.[String(detail)] ?? 99) - (b.bays?.[String(detail)] ?? 99) || a.name.localeCompare(b.name));

  const k = (e: SheetEntry) => `${e.weekly_entry_id}|${detail}`;
  const current = (e: SheetEntry) => {
    const s = e.scores?.[String(detail)];
    return edits[k(e)] ?? { score: s ? String(s.score) : "", inners: s?.inners != null ? String(s.inners) : "" };
  };
  const changed = list.filter((e) => {
    const s = e.scores?.[String(detail)];
    const c = current(e);
    if (c.score.trim() === "") return false;
    return !s || Number(c.score) !== Number(s.score) || (c.inners.trim() === "" ? null : Number(c.inners)) !== s.inners;
  });
  const invalid = changed.filter((e) => {
    const c = current(e);
    const n = Number(c.score);
    return !Number.isFinite(n) || n < 0 || n > 1000 || (c.inners.trim() !== "" && !/^\d+$/.test(c.inners.trim()));
  });

  async function saveAll() {
    const rows = changed.map((e) => {
      const c = current(e);
      return { weekly_entry_id: e.weekly_entry_id, detail, score: Number(c.score), inners: c.inners.trim() === "" ? null : Number(c.inners) };
    });
    if (await onSave(rows)) setEdits({});
  }

  return (
    <section>
      <div className="toolbar" style={{ margin: "10px 0" }}>
        {[1, 2, 3, 4].map((d) => (
          <button key={d} className={detail === d ? "primary" : "secondary"} onClick={() => setDetail(d)}>D{d}</button>
        ))}
      </div>
      <label style={{ marginRight: 16 }}><input type="checkbox" checked={only90} onChange={(e) => setOnly90(e.target.checked)} /> 90m only</label>
      <label><input type="checkbox" checked={showAll} onChange={(e) => setShowAll(e.target.checked)} /> Show entries without a bay on D{detail}</label>
      <p className="muted">Type the score (and inners for 90m), press Tab to move on, then Save. Decimal scores are fine (e.g. 104.7).</p>
      <div style={{ overflowX: "auto" }}>
        <table style={{ borderCollapse: "collapse", width: "100%" }}>
          <thead><tr><th style={th}>Bay</th><th style={th}>Name</th><th style={th}>Class</th><th style={th}>Score</th><th style={th}>Inners</th><th style={th}></th></tr></thead>
          <tbody>
            {list.map((e) => {
              const c = current(e);
              const saved = e.scores?.[String(detail)];
              return (
                <tr key={e.weekly_entry_id}>
                  <td style={td}>{e.bays?.[String(detail)] ?? "-"}</td>
                  <td style={td}>{e.name}<div className="muted" style={{ fontSize: ".75rem" }}>WEID {e.weid ?? "-"}{saved ? ` · saved (${saved.source})` : ""}</div></td>
                  <td style={td}>{e.distance} {e.class_name} {e.target_type === "P" ? "paper" : ""}</td>
                  <td style={td}><input style={inputStyle} inputMode="decimal" value={c.score}
                    onChange={(ev) => setEdits({ ...edits, [k(e)]: { ...c, score: ev.target.value } })} /></td>
                  <td style={td}><input style={{ ...inputStyle, width: 60 }} inputMode="numeric" value={c.inners}
                    onChange={(ev) => setEdits({ ...edits, [k(e)]: { ...c, inners: ev.target.value } })} /></td>
                  <td style={td}>{saved && <button className="danger" tabIndex={-1} style={{ padding: "4px 8px" }}
                    onClick={() => { if (confirm(`Remove ${e.name}'s D${detail} score?`)) void onDelete(e.weekly_entry_id, detail); }}>✕</button>}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {list.length === 0 && <p className="muted">No entries on D{detail}. Tick &quot;Show entries without a bay&quot; to see everyone.</p>}
      {invalid.length > 0 && <p className="error-text">Check the score or inners for: {invalid.map((e) => e.name).join(", ")}</p>}
      <div className="actions">
        <button className="primary" disabled={busy || changed.length === 0 || invalid.length > 0} onClick={() => void saveAll()}>
          {busy ? "Saving..." : `Save ${changed.length} D${detail} score${changed.length === 1 ? "" : "s"}`}
        </button>
      </div>
    </section>
  );
}

// ------------------------------------------------------------ Meyton import

function MeytonImport({ entries, eventDate, busy, onSave }: {
  entries: SheetEntry[]; eventDate: string; busy: boolean; onSave: (rows: object[]) => Promise<boolean>;
}) {
  const [file, setFile] = useState<{ name: string; buf: ArrayBuffer } | null>(null);
  const [fallback, setFallback] = useState<number | null>(null);
  const [result, setResult] = useState<MatchResult | null>(null);
  const [readError, setReadError] = useState("");

  useEffect(() => {
    setReadError("");
    if (!file || !eventDate) { setResult(null); return; }
    try {
      const { rows, columns } = readMeyton(file.buf, file.name);
      if (!columns.decimal && !columns.whole) { setReadError("No score column found (expected TotalRing01 or TotalRing)."); setResult(null); return; }
      if (!columns.startNr && !columns.sportpass) { setReadError("No StartNr or SportpassID column found."); setResult(null); return; }
      setResult({ ...matchToNight(rows, entries, eventDate, fallback), columns });
    } catch {
      setReadError("The file could not be read. Export it as CSV or .xlsx with a header row.");
      setResult(null);
    }
  }, [file, entries, eventDate, fallback]);

  const changes = result?.matched.filter((m) => m.previous !== m.score) ?? [];

  return (
    <section className="result info">
      <p>Export the night from Meyton (LibreOffice Base query or CSV export) with a header row. The columns are found by name:
        <strong> StartNr</strong> (the WEID), <strong>SportpassID</strong> (WASRA), <strong>TotalRing01</strong> or <strong>TotalRing</strong>,
        and <strong>Rangliste</strong> (e.g. 261203WD2, gives the detail). Zeitstempel is kept if present.</p>
      <label className="field"><span>Meyton export (.csv or .xlsx)</span>
        <input type="file" accept=".csv,.txt,.xlsx,.xls" onChange={async (e) => {
          const f = e.target.files?.[0];
          setFile(f ? { name: f.name, buf: await f.arrayBuffer() } : null);
        }} />
      </label>
      <label className="field"><span>Detail for rows that don&apos;t say (only if the file has no Rangliste/detail)</span>
        <select value={fallback ?? ""} onChange={(e) => setFallback(e.target.value ? Number(e.target.value) : null)}>
          <option value="">Work it out from the bays</option>
          {[1, 2, 3, 4].map((d) => <option key={d} value={d}>D{d}</option>)}
        </select>
      </label>
      {readError && <p className="error-text">{readError}</p>}

      {result && (
        <>
          <p className="muted">Columns used: {Object.entries(result.columns).filter(([, v]) => v).map(([k, v]) => `${k} = ${v}`).join(", ")}</p>
          <p>{result.rowsRead} rows read. <strong>{result.matched.length}</strong> scores matched
            ({changes.length} new or different from what is saved). {result.problems.length} rows need a look.</p>

          {result.problems.length > 0 && (
            <>
              <h3>Not matched</h3>
              <table style={{ borderCollapse: "collapse", width: "100%" }}>
                <thead><tr><th style={th}>Line</th><th style={th}>StartNr</th><th style={th}>WASRA</th><th style={th}>Score</th><th style={th}>List</th><th style={th}>Why</th></tr></thead>
                <tbody>{result.problems.map((p) => (
                  <tr key={p.row.line}><td style={td}>{p.row.line}</td><td style={td}>{p.row.startNr ?? ""}</td><td style={td}>{p.row.sportpass ?? ""}</td>
                    <td style={td}>{p.row.score ?? ""}</td><td style={td}>{p.row.list}</td><td style={td}>{p.reason}</td></tr>
                ))}</tbody>
              </table>
              <p className="muted">Fix these in the Enter scores tab, or correct the entry&apos;s WEID and import again.</p>
            </>
          )}

          <h3>Matched</h3>
          <table style={{ borderCollapse: "collapse", width: "100%" }}>
            <thead><tr><th style={th}>D</th><th style={th}>Name</th><th style={th}>Class</th><th style={th}>Score</th><th style={th}>Saved now</th><th style={th}>Note</th></tr></thead>
            <tbody>{result.matched.map((m) => (
              <tr key={`${m.entry.weekly_entry_id}-${m.detail}`}>
                <td style={td}>{m.detail}</td><td style={td}>{m.entry.name}</td><td style={td}>{m.entry.distance} {m.entry.class_name}</td>
                <td style={td}><strong>{m.score}</strong></td>
                <td style={td}>{m.previous === null ? "-" : m.previous === m.score ? "same" : m.previous}</td>
                <td style={td}>{[m.note, m.duplicates ? `${m.duplicates + 1} rows, highest kept` : ""].filter(Boolean).join("; ")}</td>
              </tr>
            ))}</tbody>
          </table>
          <div className="actions">
            <button className="primary" disabled={busy || result.matched.length === 0} onClick={() => void onSave(result.matched.map((m) => ({
              weekly_entry_id: m.entry.weekly_entry_id, detail: m.detail, score: m.score, meyton_list: m.list || null, shot_at: m.shotAt,
            })))}>{busy ? "Saving..." : `Save ${result.matched.length} scores`}</button>
          </div>
        </>
      )}
    </section>
  );
}

// ------------------------------------------------------------ Access history

function HistoryLoad() {
  const supabase = useMemo(() => createClient(), []);
  const [weekly, setWeekly] = useState<ArrayBuffer | null>(null);
  const [scoresFile, setScoresFile] = useState<ArrayBuffer | null>(null);
  const [parsed, setParsed] = useState<HistoryResult | null>(null);
  const [report, setReport] = useState<Record<string, unknown> | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function run(apply: boolean) {
    if (!weekly || !scoresFile) return;
    setBusy(true); setError(""); setReport(null);
    try {
      const p = parsed ?? readHistory(weekly, scoresFile);
      setParsed(p);
      const total = { rows: 0, matched: 0, new: 0, changed: 0, kept_app_scores: 0, unmatched: new Set<number>() };
      for (let i = 0; i < p.rows.length; i += 4000) {
        const { data, error: e } = await supabase.rpc("load_history_scores", { p_rows: p.rows.slice(i, i + 4000), p_apply: apply });
        if (e) { setError(`${e.message}. Run 028_scores.sql in Supabase first.`); return; }
        if (data?.outcome !== (apply ? "loaded" : "preview")) { setError(data?.message ?? "Refused."); return; }
        total.rows += data.rows; total.matched += data.matched; total.new += data.new; total.changed += data.changed;
        total.kept_app_scores += data.kept_app_scores;
        (data.unmatched_weids as number[]).forEach((w) => total.unmatched.add(w));
      }
      setReport({ ...total, unmatched: [...total.unmatched].sort((a, b) => a - b), applied: apply });
    } catch {
      setError("The files could not be read. Use the Access exports of WeeklyEntryT and ScoreT (.xlsx).");
    } finally { setBusy(false); }
  }

  const unmatched = (report?.unmatched as number[]) ?? [];
  return (
    <section className="result info">
      <p>Copies every score from Access (all of 2026, and anything earlier you have WEIDs for) into the Supabase scores table, so
        history and analysis live in one place. Matched by WEID to the entries loaded with <Link href="/admin/load-weids">Load WEIDs</Link>.
        Scores saved from Meyton or typed into the app are never overwritten. Safe to run again.</p>
      <label className="field"><span>WeeklyEntryT export (.xlsx)</span>
        <input type="file" accept=".xlsx,.xls" onChange={async (e) => { setParsed(null); setReport(null); const f = e.target.files?.[0]; setWeekly(f ? await f.arrayBuffer() : null); }} />
      </label>
      <label className="field"><span>ScoreT export (.xlsx)</span>
        <input type="file" accept=".xlsx,.xls" onChange={async (e) => { setParsed(null); setReport(null); const f = e.target.files?.[0]; setScoresFile(f ? await f.arrayBuffer() : null); }} />
      </label>
      <div className="actions">
        <button className="secondary" disabled={busy || !weekly || !scoresFile} onClick={() => void run(false)}>Check (saves nothing)</button>
        <button className="primary" disabled={busy || !report || Boolean(report.applied)} onClick={() => void run(true)}>{busy ? "Working..." : "Load into Supabase"}</button>
      </div>
      {error && <p className="error-text">{error}</p>}
      {parsed && (
        <p>{parsed.scoreRowsRead} ScoreT rows read, giving {parsed.rows.length} scores ({parsed.firstNight ?? "?"} to {parsed.lastNight ?? "?"}).
          {parsed.noEntry > 0 && ` ${parsed.noEntry} rows had no WEID or matching entry.`}
          {parsed.noScore > 0 && ` ${parsed.noScore} rows had no usable score or detail.`}</p>
      )}
      {report && (
        <div className={report.applied ? "result success" : "result warning"}>
          <strong>{report.applied ? "Loaded" : "Check result"}</strong>
          <p>{String(report.matched)} of {String(report.rows)} matched to an entry in Supabase: {String(report.new)} new, {String(report.changed)} changed,
            {" "}{String(report.kept_app_scores)} left alone because the app already has them.</p>
          {unmatched.length > 0 && <p>WEIDs not in Supabase ({unmatched.length}): {unmatched.slice(0, 60).join(", ")}{unmatched.length > 60 ? " …" : ""}. Load those WEIDs first, then run this again.</p>}
        </div>
      )}
    </section>
  );
}
