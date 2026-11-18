"use client";
import { useMemo, useState } from "react";
import * as XLSX from "xlsx";
import { createClient } from "@/lib/supabase/client";

type Row = {
  weid: number; event_date: string; wasra: number | null; name: string;
  target_type: string | null; distance: string | null; cscore: string; entry_type: string | null;
  d1: number | null; d2: number | null; d3: number | null; d4: number | null;
};

const defaultTo = () => new Date(Date.now() + 14 * 86400000).toISOString().slice(0, 10);

export default function WeidExportApp() {
  const supabase = useMemo(() => createClient(), []);
  const [from, setFrom] = useState("2026-02-01");
  const [to, setTo] = useState(defaultTo());
  const [rows, setRows] = useState<Row[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function load() {
    setBusy(true); setError(""); setRows(null);
    const { data, error } = await supabase.rpc("export_weids", { p_from: from, p_to: to });
    setBusy(false);
    if (error) { setError(error.message); return; }
    if (!data || data.outcome !== "ok") { setError(data?.message ?? "Could not export."); return; }
    setRows(data.rows as Row[]);
  }

  function sheetRows() {
    return (rows ?? []).map((r) => ({
      WeeklyEntryID: r.weid, EventDate: r.event_date, FKMEMID: r.wasra, Name: r.name,
      TargetType: r.target_type, Distance: r.distance, CScore: r.cscore, EntryType: r.entry_type,
      D1: r.d1, D2: r.d2, D3: r.d3, D4: r.d4,
    }));
  }
  function download(kind: "xlsx" | "csv") {
    const ws = XLSX.utils.json_to_sheet(sheetRows());
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "WEIDs");
    XLSX.writeFile(wb, `WASPS_WEIDs_${from}_to_${to}.${kind}`, { bookType: kind });
  }

  return (
    <main className="main">
      <h1>Export WEIDs</h1>
      <p className="muted">
        Downloads every entry that has a WEID in the date range, with its WASRA number, event date and bays,
        for loading into the Access database. The WEID is the Access WeeklyEntryID.
      </p>
      <label className="field"><span>From</span><input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></label>
      <label className="field"><span>To</span><input type="date" value={to} onChange={(e) => setTo(e.target.value)} /></label>
      <button className="primary" onClick={load} disabled={busy}>{busy ? "Loading..." : "Get WEIDs"}</button>
      {error && <p className="error-text">{error}</p>}
      {rows && (
        <div className="result info">
          <div className="result-title">{rows.length} entries with a WEID</div>
          <div className="actions">
            <button className="primary" onClick={() => download("xlsx")} disabled={!rows.length}>Download Excel</button>
            <button className="secondary" onClick={() => download("csv")} disabled={!rows.length}>Download CSV</button>
          </div>
        </div>
      )}
    </main>
  );
}
