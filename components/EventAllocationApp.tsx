"use client";
import { ChangeEvent, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { parseEntryCsv, pickDefaultDate } from "@/lib/event-allocation/csv";
import {
  allocateEvent,
  importBlockers,
  toImportPayload,
} from "@/lib/event-allocation/engine";
import {
  buildStartList,
  downloadReportPdf,
  downloadTextFile,
  electronicShootersMissingABay,
  longDate,
} from "@/lib/event-allocation/outputs";
import type {
  AllocationResult,
  ClassMapping,
  ParsedCsv,
} from "@/lib/event-allocation/types";
import type { ValidationIssue } from "@/lib/event-import/types";

const localTodayIso = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

const bay = (n: number | null) => (n === null ? "" : String(n));

export default function EventAllocationApp() {
  const supabase = useMemo(() => createClient(), []);

  const [allowed, setAllowed] = useState<boolean | null>(null);
  const [mappings, setMappings] = useState<ClassMapping[] | null>(null);
  const [mappingError, setMappingError] = useState("");

  const [parsed, setParsed] = useState<ParsedCsv | null>(null);
  const [dates, setDates] = useState<string[]>([]);
  const [eventDate, setEventDate] = useState("");
  const [startWeid, setStartWeid] = useState("");

  const [result, setResult] = useState<AllocationResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");
  const [importText, setImportText] = useState("");
  const [imported, setImported] = useState(false);

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

      const ok = Boolean(
        data?.is_active && (data.role === "admin" || data.role === "organiser"),
      );
      setAllowed(ok);
      if (!ok) return;

      const { data: mapData, error } = await supabase.rpc("list_class_mappings");
      if (error) {
        setMappingError(
          `Could not load class mappings: ${error.message}. Run 012_list_class_mappings.sql in Supabase.`,
        );
        return;
      }
      if (mapData?.outcome !== "ok") {
        setMappingError(mapData?.message ?? "Could not load class mappings.");
        return;
      }
      setMappings(mapData.mappings as ClassMapping[]);
    }

    void init();
  }, [supabase]);

  function resetResult() {
    setResult(null);
    setImportText("");
    setImported(false);
    setErrorMessage("");
  }

  async function onFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0] ?? null;
    resetResult();
    setParsed(null);
    setDates([]);
    setEventDate("");
    if (!file) return;

    setBusy(true);
    try {
      const p = await parseEntryCsv(file);
      const found = [
        ...new Set(p.rows.map((r) => r.eventDate).filter(Boolean)),
      ].sort();
      setParsed(p);
      setDates(found);
      setEventDate(pickDefaultDate(found, localTodayIso()));
      if (!found.length && !p.issues.some((i) => i.severity === "error")) {
        setErrorMessage("No readable session dates were found in the CSV.");
      }
    } catch (error) {
      setErrorMessage(
        error instanceof Error ? error.message : "Unable to read the CSV.",
      );
    } finally {
      setBusy(false);
    }
  }

  function runAllocation() {
    if (!parsed || !mappings) return;
    const weid = Number(startWeid);
    if (!Number.isInteger(weid) || weid < 1) {
      setErrorMessage("Enter the first WEID (a whole number of 1 or more).");
      return;
    }
    setErrorMessage("");
    setImportText("");
    setImported(false);
    setResult(
      allocateEvent({
        rows: parsed.rows,
        eventDate,
        classMappings: mappings,
        startWeid: weid,
      }),
    );
  }

  const blockers: ValidationIssue[] = useMemo(
    () => (result ? importBlockers(result) : []),
    [result],
  );

  const parseErrors = parsed?.issues.filter((i) => i.severity === "error") ?? [];

  async function importEvent() {
    if (!result || blockers.length) return;
    setBusy(true);
    setErrorMessage("");
    setImportText("");

    const { entries, volunteers } = toImportPayload(result);
    const { data, error } = await supabase.rpc("import_event", {
      p_event_date: result.eventDate,
      p_event_name: `WASPS Weekly Event - ${result.eventDate}`,
      p_entries: entries,
      p_volunteers: volunteers,
      p_is_test: false,
    });
    setBusy(false);

    if (error) {
      setErrorMessage(error.message);
      return;
    }
    if (data?.outcome !== "event_imported") {
      setErrorMessage(data?.message ?? "The event was not imported.");
      return;
    }
    setImported(true);
    setImportText(JSON.stringify(data, null, 2));
  }

  async function downloadPdf() {
    if (!result) return;
    setErrorMessage("");
    try {
      await downloadReportPdf(result);
    } catch (error) {
      setErrorMessage(
        error instanceof Error ? error.message : "Could not create the PDF.",
      );
    }
  }

  function downloadStartLists() {
    if (!result) return;
    ([0, 1, 2, 3] as const).forEach((i, n) => {
      const list = buildStartList(result, i);
      // Stagger so the browser doesn't drop back-to-back downloads.
      window.setTimeout(
        () => downloadTextFile(list.filename, list.content),
        n * 400,
      );
    });
  }

  if (allowed === null) {
    return <main className="main">Checking permissions...</main>;
  }

  if (!allowed) {
    return (
      <main className="main">
        <h2>Not authorised</h2>
        <p>Only administrators and organisers can allocate events.</p>
        <Link href="/sign-in">Return to sign-in</Link>
      </main>
    );
  }

  const issues: ValidationIssue[] = [
    ...(parsed?.issues ?? []),
    ...blockers,
    ...(result?.issues ?? []),
  ];

  const startLists = result
    ? ([0, 1, 2, 3] as const).map((i) => buildStartList(result, i))
    : [];
  const missingBay = result ? electronicShootersMissingABay(result) : [];

  return (
    <main className="main">
      <div className="section-head">
        <h2>Allocate event from TryBooking CSV</h2>
        <Link href="/admin/import-event">Import from Excel files</Link>
      </div>

      {mappingError !== "" ? (
        <div className="result error">
          <strong>Class mappings unavailable</strong>
          <p>{mappingError}</p>
        </div>
      ) : null}

      <section className="result info">
        <label className="field">
          <span>TryBooking entry list (CSV)</span>
          <input type="file" accept=".csv,text/csv" onChange={onFile} />
        </label>

        {dates.length > 0 ? (
          <label className="field">
            <span>Event date</span>
            <select
              value={eventDate}
              onChange={(e) => {
                setEventDate(e.target.value);
                resetResult();
              }}
            >
              {dates.map((d) => (
                <option key={d} value={d}>
                  {longDate(d)}
                </option>
              ))}
            </select>
          </label>
        ) : null}

        {dates.length > 0 ? (
          <label className="field">
            <span>First WEID (the next WeeklyEntryID in the scoring database)</span>
            <input
              type="number"
              min={1}
              step={1}
              inputMode="numeric"
              value={startWeid}
              onChange={(e) => {
                setStartWeid(e.target.value);
                resetResult();
              }}
            />
          </label>
        ) : null}

        <div className="actions">
          <button
            className="primary"
            type="button"
            disabled={
              busy ||
              !parsed ||
              parseErrors.length > 0 ||
              !eventDate ||
              !mappings
            }
            onClick={runAllocation}
          >
            {result ? "Re-run allocation (new random draw)" : "Allocate bays and volunteers"}
          </button>
        </div>
      </section>

      {errorMessage !== "" ? (
        <div className="result error">
          <strong>Problem</strong>
          <p>{errorMessage}</p>
        </div>
      ) : null}

      {parsed !== null && issues.length > 0 ? (
        <section className="result info">
          <h3>Checks</h3>
          <div className="list">
            {issues.map((issue, index) => (
              <div className="row" key={`${issue.row ?? 0}-${index}`}>
                <span>
                  {issue.row ? `Row ${issue.row}: ` : ""}
                  {issue.message}
                </span>
                <strong>{issue.severity.toUpperCase()}</strong>
              </div>
            ))}
          </div>
        </section>
      ) : null}

      {result !== null ? (
        <>
          <section className="result info">
            <h3>{longDate(result.eventDate)}</h3>
            <div className="facts">
              <div className="fact">
                <small>SHOOTERS</small>
                {result.shooters.length}
              </div>
              <div className="fact">
                <small>ELECTRONIC</small>
                {result.shooters.filter((s) => s.isElectronic).length}
              </div>
              <div className="fact">
                <small>PAPER</small>
                {result.shooters.filter((s) => s.isPaper).length}
              </div>
              <div className="fact">
                <small>FREE BAYS</small>
                {result.availableBays.length}
              </div>
            </div>
            {result.ninetyBlock.length > 0 ? (
              <p>
                90m bays: {result.ninetyBlock.join(", ")}
                {result.safetyBay !== null
                  ? ` | safety buffer bay: ${result.safetyBay}`
                  : ""}
              </p>
            ) : null}
          </section>

          <section className="result info">
            <h3>Bay assignments</h3>
            <div style={{ overflowX: "auto" }}>
              <table style={{ borderCollapse: "collapse", width: "100%" }}>
                <thead>
                  <tr>
                    {["WEID", "Competitor", "WASRA", "TT", "Dist", "Class", "Pos", "D1", "D2", "D3", "D4"].map((h) => (
                      <th key={h} style={{ textAlign: "left", padding: "4px 8px" }}>
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {[...result.shooters]
                    .sort((a, b) =>
                      a.competitor < b.competitor ? -1 : a.competitor > b.competitor ? 1 : 0,
                    )
                    .map((s) => (
                      <tr key={s.weid}>
                        <td style={{ padding: "4px 8px" }}>{s.weid}</td>
                        <td style={{ padding: "4px 8px" }}>{s.competitor}</td>
                        <td style={{ padding: "4px 8px" }}>{s.wasra ?? ""}</td>
                        <td style={{ padding: "4px 8px" }}>{s.targetCode}</td>
                        <td style={{ padding: "4px 8px" }}>{s.distance.slice(0, 3)}</td>
                        <td style={{ padding: "4px 8px" }}>{s.shootingClass.slice(0, 18)}</td>
                        <td style={{ padding: "4px 8px" }}>{s.position.slice(0, 6)}</td>
                        {s.d.map((b, i) => (
                          <td key={i} style={{ padding: "4px 8px" }}>
                            {bay(b)}
                          </td>
                        ))}
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
          </section>

          <section className="result info">
            <h3>Volunteers</h3>
            <div style={{ overflowX: "auto" }}>
              <table style={{ borderCollapse: "collapse", width: "100%" }}>
                <thead>
                  <tr>
                    {["Role", "D1", "D2", "D3", "D4"].map((h) => (
                      <th key={h} style={{ textAlign: "left", padding: "4px 8px" }}>
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {result.volunteers.map((v) => (
                    <tr key={v.role}>
                      <td style={{ padding: "4px 8px" }}>{v.role}</td>
                      {v.d.map((name, i) => (
                        <td key={i} style={{ padding: "4px 8px" }}>
                          {name}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <h3>Available bays</h3>
            <p>
              {result.availableBays.length
                ? result.availableBays.join(", ")
                : "None"}
            </p>
          </section>

          <section className="result info">
            <h3>Outputs</h3>
            <p>
              Start lists (electronic shooters only):{" "}
              {startLists.map((l) => `D${startLists.indexOf(l) + 1}: ${l.count}`).join(" | ")}
            </p>
            {missingBay.length > 0 ? (
              <p className="status">
                Electronic shooters with no bay in at least one detail, left off
                that start list: {missingBay.join("; ")}
              </p>
            ) : null}
            <div className="actions">
              <button className="primary" type="button" onClick={downloadPdf}>
                Download PDF report
              </button>
              <button className="primary" type="button" onClick={downloadStartLists}>
                Download 4 start lists
              </button>
            </div>
          </section>

          <section className="result info">
            <h3>Save to the app</h3>
            <p>
              Importing replaces any earlier import for this date. It is
              refused if the event already has sign-ins.
            </p>
            <div className="actions">
              <button
                className="primary"
                type="button"
                onClick={importEvent}
                disabled={busy || blockers.length > 0 || imported}
              >
                {busy ? "Importing..." : imported ? "Imported" : "Import event"}
              </button>
            </div>
          </section>
        </>
      ) : null}

      {importText !== "" ? (
        <section className="result success">
          <h3>Import complete</h3>
          <pre style={{ whiteSpace: "pre-wrap" }}>{importText}</pre>
          <Link href="/sign-in">Open sign-in</Link>
        </section>
      ) : null}
    </main>
  );
}
