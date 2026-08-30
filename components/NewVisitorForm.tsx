"use client";

import { FormEvent, useState } from "react";
import { createClient } from "@/lib/supabase/client";

export type VisitorResult = {
  outcome: string;
  message: string;
  event_visitor_id?: number;
  visitor_id?: number;
  temporary_number?: string;
  first_name?: string;
  surname?: string;
  visitor_name?: string;
  firearms_authority_status?: string;
  declaration_received?: boolean;
  assigned_bay?: number | null;
  signed_in_at?: string;
};

type Props = {
  eventId: number;
  onCancel: () => void;
  onCompleted: (result: VisitorResult) => Promise<void> | void;
};

export default function NewVisitorForm({ eventId, onCancel, onCompleted }: Props) {
  const [firstName, setFirstName] = useState("");
  const [surname, setSurname] = useState("");
  const [authorityStatus, setAuthorityStatus] = useState("recorded");
  const [authorityNumber, setAuthorityNumber] = useState("");
  const [dateOfBirth, setDateOfBirth] = useState("");
  const [declarationReceived, setDeclarationReceived] = useState(false);
  const [assignedBay, setAssignedBay] = useState("");
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setErrorMessage("");
    setBusy(true);

    const supabase = createClient();
    const { data, error } = await supabase.rpc("create_and_sign_in_visitor", {
      p_event_id: eventId,
      p_first_name: firstName.trim(),
      p_surname: surname.trim(),
      p_firearms_authority_status: authorityStatus,
      p_firearms_authority: authorityNumber.trim() || null,
      p_date_of_birth: dateOfBirth || null,
      p_declaration_received: declarationReceived,
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
    if (result.outcome === "possible_existing_visitor") {
      setErrorMessage(
        `${result.message} Temporary number: ${result.temporary_number ?? "unknown"}`,
      );
      return;
    }

    if (!result.outcome.startsWith("visitor_signed_in")) {
      setErrorMessage(result.message || "The visitor could not be signed in.");
      return;
    }

    await onCompleted(result);
  }

  const declarationMode = authorityStatus === "declaration";
  const recordedMode = authorityStatus === "recorded";

  return (
    <section className="result info">
      <div className="result-title">NEW VISITOR</div>
      <form onSubmit={submit}>
        <div className="facts">
          <label className="field">
            <span>First name</span>
            <input value={firstName} onChange={(e) => setFirstName(e.target.value)} required />
          </label>
          <label className="field">
            <span>Surname</span>
            <input value={surname} onChange={(e) => setSurname(e.target.value)} required />
          </label>
        </div>

        <label className="field">
          <span>Firearm authority option</span>
          <select value={authorityStatus} onChange={(e) => setAuthorityStatus(e.target.value)}>
            <option value="recorded">Authority supplied</option>
            <option value="declaration">No authority, declaration received</option>
            <option value="collect">Collect authority details</option>
            <option value="not_required">Not required</option>
          </select>
        </label>

        {recordedMode ? (
          <label className="field">
            <span>Firearm authority number</span>
            <input value={authorityNumber} onChange={(e) => setAuthorityNumber(e.target.value)} required />
          </label>
        ) : null}

        {declarationMode ? (
          <>
            <label className="field">
              <span>Date of birth</span>
              <input type="date" value={dateOfBirth} onChange={(e) => setDateOfBirth(e.target.value)} required />
            </label>
            <label className="field">
              <input type="checkbox" checked={declarationReceived} onChange={(e) => setDeclarationReceived(e.target.checked)} />{" "}
              Declaration received
            </label>
          </>
        ) : null}

        <label className="field">
          <span>Assigned bay, optional</span>
          <input type="number" min="1" max="99" value={assignedBay} onChange={(e) => setAssignedBay(e.target.value)} />
        </label>

        <label className="field">
          <span>Notes, optional</span>
          <input value={notes} onChange={(e) => setNotes(e.target.value)} />
        </label>

        {errorMessage !== "" ? <p className="error-text">{errorMessage}</p> : null}

        <div className="actions">
          <button className="primary" type="submit" disabled={busy}>
            {busy ? "Signing in..." : "Create visitor and sign in"}
          </button>
          <button className="secondary" type="button" onClick={onCancel} disabled={busy}>Cancel</button>
        </div>
      </form>
    </section>
  );
}
