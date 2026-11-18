"use client";
import { useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { DEFAULT_MCID } from "@/lib/event-allocation/rules";
import { buildStartList, downloadTextFile, longDate, type StartList } from "@/lib/event-allocation/outputs";
import type { AllocationResult, Shooter } from "@/lib/event-allocation/types";

type Ev = { id: number; event_date: string; entries: number };
type Row = {
  weid: number; first_name: string | null; surname: string | null; entry_name: string | null;
  wasra: number | null; target_type: string | null; distance: string | null;
  fkcid: number | null; mcid: number | null;
  d1: number | null; d2: number | null; d3: number | null; d4: number | null;
};

function name(r: Row) {
  if (r.surname || r.first_name) return `${(r.surname ?? "").toUpperCase()},${r.first_name ?? ""}`;
  return r.entry_name ?? "";
}

export default function StartListsApp() {
  const supabase = useMemo(() => createClient(), []);
  const [events, setEvents] = useState<Ev[]>([]);
  const [eventId, setEventId] = useState<number | null>(null);
  const [lists, setLists] = useState<StartList[] | null>(null);
  const [notes, setNotes] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    (async () => {
      const { data, error } = await supabase.rpc("list_recent_events");
      if (error || data?.outcome !== "ok") { setError(error?.message ?? data?.message ?? "Could not load events."); return; }
      setEvents(data.events);
      if (data.events.length) setEventId(data.events[0].id);
    })();
  }, [supabase]);

  async function build() {
    if (eventId === null) return;
    setBusy(true); setError(""); setLists(null); setNotes([]);
    const { data, error } = await supabase.rpc("event_start_list", { p_event_id: eventId });
    setBusy(false);
    if (error) { setError(error.message); return; }
    if (data?.outcome !== "ok") { setError(data?.message ?? "Could not build the start lists."); return; }
    const rows = data.rows as Row[];
    const shooters = rows.map((r) => {
      const paper = (r.target_type ?? "").toUpperCase() === "P";
      return {
        weid: r.weid, competitor: name(r), wasra: r.wasra, isPaper: paper,
        mcid: r.mcid ?? DEFAULT_MCID, fkcid: r.fkcid, d: [r.d1, r.d2, r.d3, r.d4],
      } as unknown as Shooter;
    });
    const result = { eventDate: data.event_date, shooters } as unknown as AllocationResult;
    setLists([0, 1, 2, 3].map((i) => buildStartList(result, i as 0 | 1 | 2 | 3)));

    const n: string[] = [];
    if (data.new_weids.length) n.push(`${data.new_weids.length} entr${data.new_weids.length === 1 ? "y" : "ies"} had no WEID (late entries); given ${data.new_weids.join(", ")}.`);
    const noBay = rows.filter((r) => (r.target_type ?? "").toUpperCase() !== "P" && [r.d1, r.d2, r.d3, r.d4].some((b) => b === null)).map(name);
    if (noBay.length) n.push(`Electronic entries missing a bay on at least one detail (left off that detail's list): ${noBay.join("; ")}.`);
    const noWasra = rows.filter((r) => r.wasra === null && (r.target_type ?? "").toUpperCase() !== "P").map(name);
    if (noWasra.length) n.push(`No WASRA number (left off all lists): ${noWasra.join("; ")}.`);
    setNotes(n);
  }

  const ev = events.find((e) => e.id === eventId);
  return (
    <main className="main">
      <h1>Meyton start lists</h1>
      <p className="muted">
        Builds the D1–D4 start list files from the entries saved in the app, including late entries added at sign-on.
        Run it again after any change. Entries already have their WEID, and late entries are given the next free one.
      </p>
      <label className="field"><span>Event</span>
        <select value={eventId ?? ""} onChange={(e) => setEventId(Number(e.target.value))}>
          {events.map((e) => <option key={e.id} value={e.id}>{longDate(e.event_date)} ({e.entries} entries)</option>)}
        </select>
      </label>
      <button className="primary" onClick={build} disabled={busy || eventId === null}>{busy ? "Building..." : "Build start lists"}</button>
      {error && <p className="error-text">{error}</p>}
      {lists && (
        <div className="result info">
          <div className="result-title">{ev ? longDate(ev.event_date) : ""}</div>
          {notes.map((t, i) => <p key={i}>{t}</p>)}
          <div className="actions">
            {lists.map((l, i) => (
              <button key={i} className="primary" disabled={!l.count} onClick={() => downloadTextFile(l.filename, l.content)}>
                D{i + 1} ({l.count})
              </button>
            ))}
            <button className="secondary" onClick={() => lists.forEach((l) => l.count && downloadTextFile(l.filename, l.content))}>Download all</button>
          </div>
        </div>
      )}
    </main>
  );
}
