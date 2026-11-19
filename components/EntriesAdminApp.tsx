"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { longDate } from "@/lib/event-allocation/outputs";
import type { FormEntry } from "@/lib/event-allocation/entries";

type Ev = { id: number; event_date: string; name: string | null; entries_open: boolean; entry_count: number };

export default function EntriesAdminApp() {
  const supabase = useMemo(() => createClient(), []);
  const [events, setEvents] = useState<Ev[]>([]);
  const [selected, setSelected] = useState<Ev | null>(null);
  const [entries, setEntries] = useState<FormEntry[]>([]);
  const [error, setError] = useState("");

  const loadEvents = useCallback(async () => {
    const { data, error } = await supabase.rpc("admin_list_entry_events");
    if (error || data?.outcome !== "ok") { setError(error?.message ?? data?.message ?? "Could not load events."); return; }
    setEvents(data.events);
    setSelected((cur) => (cur ? (data.events as Ev[]).find((e) => e.id === cur.id) ?? null : null));
  }, [supabase]);

  const loadEntries = useCallback(async (ev: Ev) => {
    const { data, error } = await supabase.rpc("list_event_entries", { p_event_id: ev.id });
    if (error || data?.outcome !== "ok") { setError(error?.message ?? data?.message ?? "Could not load entries."); return; }
    setEntries(data.entries);
  }, [supabase]);

  useEffect(() => { loadEvents(); }, [loadEvents]);
  useEffect(() => { if (selected) loadEntries(selected); else setEntries([]); }, [selected, loadEntries]);

  async function toggle(ev: Ev) {
    setError("");
    const { data, error } = await supabase.rpc("set_entries_open", { p_event_id: ev.id, p_open: !ev.entries_open });
    if (error || data?.outcome !== "ok") { setError(error?.message ?? data?.message ?? "Could not change."); return; }
    await loadEvents();
  }
  async function remove(id: number) {
    if (!window.confirm("Delete this entry?")) return;
    const { data, error } = await supabase.rpc("delete_event_entry", { p_entry_id: id });
    if (error || data?.outcome !== "ok") { setError(error?.message ?? data?.message ?? "Could not delete."); return; }
    if (selected) { await loadEntries(selected); await loadEvents(); }
  }

  return (
    <main className="main">
      <h1>Online entries</h1>
      <p className="muted">Open an event so people can enter at <b>/enter</b>. Entries are combined with the TryBooking CSV on the allocation page.</p>
      {error && <p className="error-text">{error}</p>}
      {events.map((e) => (
        <div key={e.id} className="result info" style={{ marginBottom: 10 }}>
          <div className="result-title">{longDate(e.event_date)}{e.name ? ` - ${e.name}` : ""}</div>
          <p>{e.entry_count} entr{e.entry_count === 1 ? "y" : "ies"} - entries are <b>{e.entries_open ? "OPEN" : "closed"}</b></p>
          <div className="actions">
            <button className={e.entries_open ? "secondary" : "primary"} onClick={() => toggle(e)}>{e.entries_open ? "Close entries" : "Open entries"}</button>
            <button className="secondary" onClick={() => setSelected(selected?.id === e.id ? null : e)}>{selected?.id === e.id ? "Hide entries" : "View entries"}</button>
          </div>
          {selected?.id === e.id && (
            <div style={{ overflowX: "auto", marginTop: 10 }}>
              <table style={{ width: "100%", fontSize: 14 }}>
                <thead><tr><th align="left">Name</th><th align="left">WASRA</th><th align="left">Class</th><th align="left">Pos</th><th align="left">Dist</th><th align="left">Type</th><th></th></tr></thead>
                <tbody>
                  {entries.map((x) => (
                    <tr key={x.id}>
                      <td>{x.first_name} {x.surname}{x.is_visitor ? " (visitor)" : ""}</td>
                      <td>{x.wasra_number ?? "-"}</td><td>{x.shooting_class}</td><td>{x.position}</td><td>{x.distance}</td><td>{x.target_type}</td>
                      <td><button className="danger" onClick={() => remove(x.id)}>Delete</button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      ))}
    </main>
  );
}
