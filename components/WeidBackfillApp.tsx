"use client";
import { ChangeEvent, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { readRows, type Row } from "@/lib/weid-backfill/parse";

type Problem = {
  row: number;
  weid: number | null;
  event_date: string | null;
  wasra: number | null;
  name: string | null;
  status: string;
  note: string | null;
};

type Report = {
  outcome: string;
  message?: string;
  applied?: boolean;
  rows?: number;
  counts?: Record<string, number>;
  problems?: Problem[];
};

const LABELS: Record<string, string> = {
  matched: "Matched an existing entry, WEID added",
  created: "New entry created from Access",
  created_extra: "Extra entry created (same person twice on one date in Access)",
  already_loaded: "Already has this WEID",
  skipped_no_weid: "Skipped: no ID in the file",
  skipped_no_wasra: "Skipped: no WASRA number",
  skipped_no_date: "Skipped: no event date",
  skipped_no_event: "Skipped: no event on that date",
  skipped_duplicate_weid: "Skipped: ID used twice in the file",
  skipped_weid_in_use: "Skipped: ID already used by another entry",
  skipped_conflict: "Skipped: Supabase has a different WEID for this person",
};

export default function WeidBackfillApp() {
  const supabase = useMemo(() => createClient(), []);
  const [allowed, setAllowed] = useState<boolean | null>(null);
  const [rows, setRows] = useState<Row[] | null>(null);
  const [fileName, setFileName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [preview, setPreview] = useState<Report | null>(null);
  const [done, setDone] = useState<Report | null>(null);

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

  async function onFile(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    setRows(null);
    setPreview(null);
    setDone(null);
    setError("");
    if (!file) return;
    setFileName(file.name);
    try {
      setRows(readRows(await file.arrayBuffer()));
    } catch {
      setError("That file could not be read. Use the WeeklyEntryT export from Access (.xlsx).");
    }
  }

  async function run(apply: boolean) {
    if (!rows || busy) return;
    setBusy(true);
    setError("");
    try {
      const { data, error: rpcError } = await supabase.rpc("backfill_weids", {
        p_rows: rows,
        p_apply: apply,
      });
      if (rpcError) {
        setError(
          `The request failed: ${rpcError.message}. Run 017_backfill_weids.sql in Supabase first.`,
        );
        return;
      }
      const report = data as Report;
      if (report.outcome !== "preview" && report.outcome !== "loaded") {
        setError(report.message ?? "The request was refused.");
        return;
      }
      if (apply) {
        setDone(report);
        setPreview(null);
      } else {
        setPreview(report);
      }
    } finally {
      setBusy(false);
    }
  }

  if (allowed === null) return <main className="main">Checking permissions...</main>;
  if (!allowed) {
    return (
      <main className="main">
        <h2>Not authorised</h2>
        <p>Only administrators and organisers can load WEIDs.</p>
        <Link href="/sign-in">Return to sign-in</Link>
      </main>
    );
  }

  const report = done ?? preview;
  const willChange =
    (preview?.counts?.matched ?? 0) +
    (preview?.counts?.created ?? 0) +
    (preview?.counts?.created_extra ?? 0);

  return (
    <main className="main">
      <h1>Load WEIDs from Access</h1>
      <p className="muted">
        Reads the Access WeeklyEntryT export and gives each Supabase entry its
        WEID (the WeeklyEntryID column). Nothing is saved until you press Load.
        You can run it again later with a newer export.
      </p>

      <section className="result info">
        <label className="field">
          <span>WeeklyEntryT export (.xlsx)</span>
          <input type="file" accept=".xlsx,.xls,.csv" onChange={onFile} />
        </label>
        {rows ? (
          <p>
            {fileName}: {rows.length} entries read.
          </p>
        ) : null}
        <div className="actions">
          <button
            className="primary"
            type="button"
            disabled={!rows || busy}
            onClick={() => void run(false)}
          >
            {busy && !preview ? "Checking..." : "Preview (saves nothing)"}
          </button>
        </div>
      </section>

      {error !== "" ? (
        <div className="result error">
          <strong>Problem</strong>
          <p>{error}</p>
        </div>
      ) : null}

      {report ? (
        <section className="result info">
          <h2>{done ? "Loaded" : "Preview"}</h2>
          <table style={{ borderCollapse: "collapse" }}>
            <tbody>
              {Object.entries(report.counts ?? {}).map(([k, v]) => (
                <tr key={k}>
                  <td style={{ padding: "4px 12px 4px 0" }}>{LABELS[k] ?? k}</td>
                  <td style={{ padding: "4px 0" }}>
                    <strong>{v}</strong>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          {(report.problems ?? []).length > 0 ? (
            <>
              <h3>Rows to check</h3>
              <table style={{ borderCollapse: "collapse", width: "100%" }}>
                <thead>
                  <tr>
                    <th align="left">WEID</th>
                    <th align="left">Date</th>
                    <th align="left">Name</th>
                    <th align="left">WASRA</th>
                    <th align="left">What happened</th>
                  </tr>
                </thead>
                <tbody>
                  {report.problems!.map((p) => (
                    <tr key={`${p.row}-${p.status}`}>
                      <td style={{ padding: "3px 8px 3px 0" }}>{p.weid ?? ""}</td>
                      <td style={{ padding: "3px 8px 3px 0" }}>{p.event_date ?? ""}</td>
                      <td style={{ padding: "3px 8px 3px 0" }}>{p.name}</td>
                      <td style={{ padding: "3px 8px 3px 0" }}>{p.wasra ?? ""}</td>
                      <td style={{ padding: "3px 0" }}>
                        {LABELS[p.status] ?? p.status}
                        {p.note ? `. ${p.note}` : ""}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          ) : null}

          {preview ? (
            <div className="actions">
              <button
                className="primary"
                type="button"
                disabled={busy || willChange === 0}
                onClick={() => void run(true)}
              >
                {busy ? "Loading..." : `Load ${willChange} entries into Supabase`}
              </button>
            </div>
          ) : (
            <p>
              Done. Rows listed above were not loaded. Fix them in Access, export
              again and run this page again.
            </p>
          )}
        </section>
      ) : null}
    </main>
  );
}
