"use client";
// Corrected event importer
import { FormEvent, useEffect, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { parseEventFiles } from "@/lib/event-import/parser";
import type { ImportPreview } from "@/lib/event-import/types";

export default function EventImportApp() {
  const supabase = createClient();

  const [allowed, setAllowed] = useState<boolean | null>(null);
  const [bayFile, setBayFile] = useState<File | null>(null);
  const [volunteerFile, setVolunteerFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [busy, setBusy] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");
  const [resultText, setResultText] = useState("");

  useEffect(() => {
    async function checkPermission() {
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
        Boolean(
          data?.is_active &&
            (data.role === "admin" || data.role === "organiser"),
        ),
      );
    }

    void checkPermission();
  }, []);

  async function validateFiles(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!bayFile || !volunteerFile) {
      setErrorMessage("Select both assignment files.");
      return;
    }

    setBusy(true);
    setErrorMessage("");
    setResultText("");

    try {
      const parsed = await parseEventFiles(bayFile, volunteerFile);
      setPreview(parsed);
    } catch (error) {
      setErrorMessage(
        error instanceof Error ? error.message : "Unable to read the files.",
      );
    } finally {
      setBusy(false);
    }
  }

  async function importEvent() {
    if (!preview || preview.issues.some((issue) => issue.severity === "error")) {
      return;
    }

    setBusy(true);
    setErrorMessage("");
    setResultText("");

    const { data, error } = await supabase.rpc("import_event", {
      p_event_date: preview.eventDate,
      p_event_name: `WASPS Weekly Event - ${preview.eventDate}`,
      p_entries: preview.entries,
      p_volunteers: preview.volunteers,
      p_is_test: false,
    });

    setBusy(false);

    if (error) {
      setErrorMessage(error.message);
      return;
    }

    setResultText(JSON.stringify(data, null, 2));
  }

  if (allowed === null) {
    return <main className="main">Checking permissions...</main>;
  }

  if (!allowed) {
    return (
      <main className="main">
        <h2>Not authorised</h2>
        <p>Only administrators and organisers can import event assignments.</p>
        <Link href="/sign-in">Return to sign-in</Link>
      </main>
    );
  }

  return (
    <main className="main">
      <div className="section-head">
        <h2>Import event</h2>
        <Link href="/sign-in">Back to sign-in</Link>
      </div>

      <form onSubmit={validateFiles} className="result info">
        <label className="field">
          <span>BayAssignments.xlsx</span>
          <input
            type="file"
            accept=".xlsx,.xls"
            required
            onChange={(event) => {
              setBayFile(event.target.files?.[0] ?? null);
              setPreview(null);
            }}
          />
        </label>

        <label className="field">
          <span>VolunteerAssignments.xlsx</span>
          <input
            type="file"
            accept=".xlsx,.xls"
            required
            onChange={(event) => {
              setVolunteerFile(event.target.files?.[0] ?? null);
              setPreview(null);
            }}
          />
        </label>

        <button className="primary" disabled={busy} type="submit">
          {busy ? "Working..." : "Validate files"}
        </button>
      </form>

      {errorMessage !== "" ? (
        <div className="result error">
          <strong>Import error</strong>
          <p>{errorMessage}</p>
        </div>
      ) : null}

      {preview !== null ? (
        <section className="result info">
          <h3>Validation preview</h3>

          <div className="facts">
            <div className="fact">
              <small>EVENT DATE</small>
              {preview.eventDate}
            </div>
            <div className="fact">
              <small>COMPETITORS</small>
              {preview.entries.length}
            </div>
            <div className="fact">
              <small>BAY ASSIGNMENTS</small>
              {preview.bayCount}
            </div>
            <div className="fact">
              <small>VOLUNTEERS</small>
              {preview.volunteers.length}
            </div>
          </div>

          {preview.issues.length === 0 ? (
            <p className="status good">No file-format errors found.</p>
          ) : (
            <div className="list">
              {preview.issues.map((issue, index) => (
                <div className="row" key={`${issue.row ?? 0}-${index}`}>
                  <span>
                    {issue.row ? `Row ${issue.row}: ` : ""}
                    {issue.message}
                  </span>
                  <strong>{issue.severity.toUpperCase()}</strong>
                </div>
              ))}
            </div>
          )}

          <div className="actions">
            <button
              className="primary"
              type="button"
              onClick={importEvent}
              disabled={
                busy ||
                preview.issues.some((issue) => issue.severity === "error")
              }
            >
              {busy ? "Importing..." : "Import event"}
            </button>
          </div>
        </section>
      ) : null}

      {resultText !== "" ? (
        <section className="result success">
          <h3>Import complete</h3>
          <pre style={{ whiteSpace: "pre-wrap" }}>{resultText}</pre>
          <Link href="/sign-in">Open sign-in</Link>
        </section>
      ) : null}
    </main>
  );
}
