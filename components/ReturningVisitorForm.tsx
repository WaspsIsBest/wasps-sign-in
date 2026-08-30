"use client";

import { FormEvent, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import type { VisitorResult } from "./NewVisitorForm";

type SearchRow = {
  visitor_id: number;
  temporary_number: string;
  first_name: string;
  surname: string;
  firearms_authority_status: string;
  declaration_received: boolean;
  last_visit_date: string | null;
  visit_count: number;
};

type Props = {
  eventId: number;
  onCancel: () => void;
  onCompleted: (result: VisitorResult) => Promise<void> | void;
};

export default function ReturningVisitorForm({ eventId, onCancel, onCompleted }: Props) {
  const [searchText, setSearchText] = useState("");
  const [results, setResults] = useState<SearchRow[]>([]);
  const [selected, setSelected] = useState<SearchRow | null>(null);
  const [assignedBay, setAssignedBay] = useState("");
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");

  async function search(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setErrorMessage("");
    setSelected(null);
    setBusy(true);

    const supabase = createClient();
    const { data, error } = await supabase.rpc("search_returning_visitors", {
      p_search_text: searchText.trim(),
      p_limit: 20,
    });

    setBusy(false);
    if (error) {
      setErrorMessage(error.message);
      return;
    }

    const rows = (data ?? []) as SearchRow[];
    setResults(rows);
    if (rows.length === 0) setErrorMessage("No matching visitor was found.");
  }

  async function signIn() {
    if (!selected) return;
    setErrorMessage("");
    setBusy(true);

    const supabase = createClient();
    const { data, error } = await supabase.rpc("sign_in_returning_visitor", {
      p_event_id: eventId,
      p_visitor_id: selected.visitor_id,
      p_firearms_authority_status: null,
      p_firearms_authority: null,
      p_date_of_birth: null,
      p_declaration_received: null,
      p_host_member_id: null,
      p_assigned_bay: assignedBay === "" ? null : Number(assignedBay),
      p_notes: notes.trim() || null,
    });

    setBusy(false);
    if (error) {
      setErrorMessage(error.message);
      return;
    }

    const result = data as VisitorResult;
    if (
      result.outcome !== "returning_visitor_signed_in" &&
      result.outcome !== "returning_visitor_signed_in_with_warning"
    ) {
      setErrorMessage(result.message || "The visitor could not be signed in.");
      return;
    }

    await onCompleted(result);
  }

  return (
    <section className="result info">
      <div className="result-title">RETURNING VISITOR</div>

      <form onSubmit={search} className="scan-form">
        <input
          className="scan-input"
          placeholder="Enter V-number or visitor name"
          value={searchText}
          onChange={(e) => setSearchText(e.target.value)}
          required
        />
        <button className="primary" disabled={busy}>{busy ? "Searching..." : "Search"}</button>
      </form>

      {results.length > 0 && !selected ? (
        <div className="list">
          {results.map((visitor) => (
            <button
              key={visitor.visitor_id}
              type="button"
              className="row"
              style={{ width: "100%", background: "white", borderLeft: 0, borderRight: 0, borderTop: 0, textAlign: "left" }}
              onClick={() => setSelected(visitor)}
            >
              <span className="row-main">
                <span className="row-name">{visitor.first_name} {visitor.surname}</span>
                <span className="row-meta" style={{ display: "block" }}>
                  {visitor.temporary_number} • {visitor.firearms_authority_status.replaceAll("_", " ")} • {visitor.visit_count} visit(s)
                </span>
              </span>
              <span className="status good">SELECT</span>
            </button>
          ))}
        </div>
      ) : null}

      {selected ? (
        <div className="result success">
          <div className="person">{selected.first_name} {selected.surname}</div>
          <div className="muted">{selected.temporary_number}</div>
          <p>Authority status: {selected.firearms_authority_status.replaceAll("_", " ")}</p>

          <label className="field">
            <span>Assigned bay, optional</span>
            <input type="number" min="1" max="99" value={assignedBay} onChange={(e) => setAssignedBay(e.target.value)} />
          </label>
          <label className="field">
            <span>Notes, optional</span>
            <input value={notes} onChange={(e) => setNotes(e.target.value)} />
          </label>

          <div className="actions">
            <button className="primary" type="button" onClick={signIn} disabled={busy}>
              {busy ? "Signing in..." : "Sign in returning visitor"}
            </button>
            <button className="secondary" type="button" onClick={() => setSelected(null)} disabled={busy}>Back to results</button>
          </div>
        </div>
      ) : null}

      {errorMessage !== "" ? <p className="error-text">{errorMessage}</p> : null}

      <div className="actions">
        <button className="secondary" type="button" onClick={onCancel} disabled={busy}>Cancel visitor sign-in</button>
      </div>
    </section>
  );
}
