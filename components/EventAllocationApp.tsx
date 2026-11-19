"use client";
import { ChangeEvent, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { parseEntryCsv, pickDefaultDate } from "@/lib/event-allocation/csv";
import { entriesToParsed, type FormEntry } from "@/lib/event-allocation/entries";
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

type ImportSummary = {
  entries: number;
  bays: number;
  volunteers: number;
  unmatchedMembers: number;
  unmatchedVolunteers: string[];
  duplicatesSkipped: number;
};

// A friendlier version of the database's technical error text.
function explainImportError(message: string) {
  if (message.includes("event_has_sign_ins") || /sign-?in/i.test(message)) {
    return "This event already has sign-ins, so it can no longer be re-imported.";
  }
  if (/permission denied|not_authorised|not authorised/i.test(message)) {
    return "You are not signed in as an administrator or organiser. Sign in again and retry.";
  }
  if (/JWT|expired|not authenticated/i.test(message)) {
    return "Your sign-in has expired. Sign in again and retry.";
  }
  return message;
}

export default function EventAllocationApp() {
  const supabase = useMemo(() => createClient(), []);

  const [allowed, setAllowed] = useState<boolean | null>(null);
  const [mappings, setMappings] = useState<ClassMapping[] | null>(null);
  const [mappingError, setMappingError] = useState("");

  const [parsed, setParsed] = useState<ParsedCsv | null>(null);
  const [dates, setDates] = useState<string[]>([]);
  const [eventDate, setEventDate] = useState("");
  const [startWeid, setStartWeid] = useState("");
  const [weidNote, setWeidNote] = useState("");

  const [result, setResult] = useState<AllocationResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");
  const [importError, setImportError] = useState("");
  const [importSummary, setImportSummary] = useState<ImportSummary | null>(null);
  const importRef = useRef<HTMLElement | null>(null);
  const [imported, setImported] = useState(false);
  const [formEvents, setFormEvents] = useState<{ id: number; event_date: string; entry_count: number }[]>([]);
  const [formDate, setFormDate] = useState("");
  const [formNote, setFormNote] = useState("");
  const [csvParsed, setCsvParsed] = useState<ParsedCsv | null>(null);

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

  // Look up the first WEID from what is already saved in the app. The field
  // stays editable, so it can always be overridden.
  useEffect(() => {
    if (!allowed || !eventDate) return;
    let cancelled = false;

    async function lookup() {
      const { data, error } = await supabase.rpc("next_weid", {
        p_event_date: eventDate,
      });
      if (cancelled) return;

      if (error || data?.outcome !== "ok") {
        setWeidNote(
          "Could not look up the next WEID automatically (has 013_weid_in_supabase.sql been run in Supabase?). Enter it by hand.",
        );
        return;
      }

      if (data.event_first_weid !== null && data.event_first_weid !== undefined) {
        setStartWeid(String(data.event_first_weid));
        setWeidNote(
          "This date was imported before, so it starts from the same WEID again.",
        );
      } else if (data.next_weid !== null && data.next_weid !== undefined) {
        setStartWeid(String(data.next_weid));
        setWeidNote(
          `One more than the highest WEID saved in the app (${data.max_weid}).`,
        );
      } else {
        setStartWeid("");
        setWeidNote(
          "No WEIDs are saved in the app yet. Enter the next WeeklyEntryID from the scoring database this one time.",
        );
      }
    }

    void lookup();
    return () => {
      cancelled = true;
    };
  }, [allowed, eventDate, supabase]);

  function resetResult() {
    setResult(null);
    setImportError("");
    setImportSummary(null);
    setImported(false);
    setErrorMessage("");
  }

  useEffect(() => {
    if (!allowed) return;
    (async () => {
      const { data } = await supabase.rpc("admin_list_entry_events");
      if (data?.outcome === "ok") {
        const list = (data.events as { id: number; event_date: string; entry_count: number }[]).filter((e) => e.entry_count > 0);
        setFormEvents(list);
        if (list.length) setFormDate(list[0].event_date);
      }
    })();
  }, [allowed, supabase]);

  // Combine the TryBooking CSV (if loaded) with entries made on the online
  // form for the chosen date. The CSV comes first, so if someone appears in
  // both, the allocation keeps their TryBooking entry and warns.
  async function addFormEntries() {
    const ev = formEvents.find((e) => e.event_date === formDate);
    if (!ev) return;
    setBusy(true);
    setErrorMessage("");
    resetResult();
    const { data, error } = await supabase.rpc("list_event_entries", { p_event_id: ev.id });
    setBusy(false);
    if (error || data?.outcome !== "ok") {
      setErrorMessage(error?.message ?? data?.message ?? "Could not load the online form entries.");
      return;
    }
    const entries = data.entries as FormEntry[];
    const form = entriesToParsed(formDate, entries);
    const base = csvParsed;
    const rows = [...(base?.rows ?? []), ...form.rows];
    const merged: ParsedCsv = { rows, issues: [...(base?.issues ?? []), ...form.issues] };
    const found = [...new Set(rows.map((r) => r.eventDate).filter(Boolean))].sort();
    setParsed(merged);
    setDates(found);
    setEventDate(formDate);
    setFormNote(`${entries.length} online form ${entries.length === 1 ? "entry" : "entries"} added${base ? ` to ${base.rows.length} TryBooking rows` : ""}.`);
  }

  async function onFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0] ?? null;
    resetResult();
    setParsed(null);
    setCsvParsed(null);
    setFormNote("");
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
      setCsvParsed(p);
      setFormNote("");
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
    setImportError("");
    setImportSummary(null);
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
    setImportError("");
    setImportSummary(null);

    const { entries, volunteers } = toImportPayload(result);

    // Send each volunteer's WASRA number as well, so they are matched to the
    // member record even if their name is spelled differently.
    const wasraByName = new Map<string, number>();
    for (const s of result.shooters) {
      if (s.wasra !== null && s.wasra > 0) {
        wasraByName.set(`${s.fname.trim()} ${s.surname.trim()}`, s.wasra);
      }
    }
    const volunteersWithWasra = volunteers.map((v) => ({
      ...v,
      wasra_number: wasraByName.get(v.member_name.trim()) ?? null,
    }));

    try {
      const { data, error } = await supabase.rpc("import_event", {
        p_event_date: result.eventDate,
        p_event_name: `WASPS Weekly Event - ${result.eventDate}`,
        p_entries: entries,
        p_volunteers: volunteersWithWasra,
        p_is_test: false,
      });

      if (error) {
        setImportError(explainImportError(error.message));
      } else if (data?.outcome !== "event_imported") {
        setImportError(
          explainImportError(data?.message ?? "The event was not imported."),
        );
      } else {
        setImported(true);
        setImportSummary({
          entries: Number(data.entries_imported ?? 0),
          bays: Number(data.bay_assignments_imported ?? 0),
          volunteers: Number(data.volunteers_imported ?? 0),
          unmatchedMembers: Number(data.members_unmatched ?? 0),
          unmatchedVolunteers: Array.isArray(data.volunteers_unmatched)
            ? (data.volunteers_unmatched as string[])
            : [],
          duplicatesSkipped: Number(data.duplicate_entries_skipped ?? 0),
        });
      }
    } catch (caught) {
      setImportError(
        caught instanceof Error
          ? caught.message
          : "The import could not be completed.",
      );
    } finally {
      setBusy(false);
      // The result is shown right beside the button; make sure it is in view.
      window.setTimeout(
        () => importRef.current?.scrollIntoView({ behavior: "smooth", block: "center" }),
        50,
      );
    }
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
        <h2>Allocate event from TryBooking CSV and/or online form</h2>
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

        {formEvents.length > 0 ? (
          <div className="field">
            <span>Online form entries (beta)</span>
            <select value={formDate} onChange={(e) => setFormDate(e.target.value)}>
              {formEvents.map((e) => (
                <option key={e.id} value={e.event_date}>
                  {longDate(e.event_date)} ({e.entry_count} entries)
                </option>
              ))}
            </select>
            <button className="secondary" type="button" disabled={busy || !formDate} onClick={addFormEntries}>
              {csvParsed ? "Add online form entries to the CSV" : "Use online form entries only"}
            </button>
            {formNote !== "" ? <small>{formNote}</small> : null}
          </div>
        ) : null}

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
            <span>First WEID</span>
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
            {weidNote !== "" ? <small>{weidNote}</small> : null}
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

          <section
            className="result info"
            ref={(node) => {
              importRef.current = node;
            }}
          >
            <h3>Save to the app</h3>
            <p>
              Importing replaces any earlier import for this date. It is
              refused if the event already has sign-ins.
            </p>

            {blockers.length > 0 ? (
              <div className="result error">
                <strong>
                  Import is switched off until {blockers.length === 1 ? "this is" : "these are"} fixed in the CSV:
                </strong>
                <div className="list">
                  {blockers.map((b, i) => (
                    <div className="row" key={i}>
                      <span>
                        {b.row ? `Row ${b.row}: ` : ""}
                        {b.message}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            ) : null}

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

            {importError !== "" ? (
              <div className="result error">
                <strong>The import did not go through</strong>
                <p>{importError}</p>
              </div>
            ) : null}

            {importSummary !== null ? (
              <div className="result success">
                <strong>Import complete</strong>
                <p>
                  {importSummary.entries} entries, {importSummary.bays} bay
                  assignments and {importSummary.volunteers} volunteer
                  assignments saved.
                </p>
                {importSummary.unmatchedMembers > 0 ? (
                  <p className="status">
                    {importSummary.unmatchedMembers} entrant(s) were not matched
                    to a member by WASRA number. They are saved but may need
                    checking.
                  </p>
                ) : null}
                {importSummary.unmatchedVolunteers.length > 0 ? (
                  <p className="status">
                    These volunteers could not be matched to a member and were
                    NOT saved as volunteers:{" "}
                    {importSummary.unmatchedVolunteers.join(", ")}.
                  </p>
                ) : null}
                <Link href="/sign-in">Open sign-in</Link>
              </div>
            ) : null}
          </section>
        </>
      ) : null}
    </main>
  );
}
