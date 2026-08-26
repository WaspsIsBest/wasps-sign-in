"use client";

import { FormEvent, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";

export type LateEntryMember = {
  member_id: number;
  wasra_number?: number;
  competitor_name?: string;
  membership_status?: string;
};

type LateEntryResult = {
  outcome: string;
  message: string;
  sign_in_id?: number;
  weekly_entry_id?: number;
  member_id?: number;
  wasra_number?: number;
  competitor_name?: string;
  membership_status?: string;
  firearms_authority_display?: string;
  target_type?: string;
  distance?: string;
  shooting_class?: string;
  position?: string;
  d1?: number | null;
  d2?: number | null;
  d3?: number | null;
  d4?: number | null;
  warning_code?: string | null;
};

type Props = {
  eventId: number;
  member: LateEntryMember;
  onCancel: () => void;
  onCompleted: (result: LateEntryResult) => Promise<void> | void;
};

const CLASS_OPTIONS = ["Sporter", "Modified", "F-Open", "Benchrest"];

function optionalBay(value: string) {
  if (value.trim() === "") return null;
  return Number(value);
}

export default function LateEntryForm({
  eventId,
  member,
  onCancel,
  onCompleted,
}: Props) {
  const [targetType, setTargetType] = useState<"E" | "P">("E");
  const [distance, setDistance] = useState("50m");
  const [shootingClass, setShootingClass] = useState("Sporter");
  const [position, setPosition] = useState("Prone");
  const [d1, setD1] = useState("");
  const [d2, setD2] = useState("");
  const [d3, setD3] = useState("");
  const [d4, setD4] = useState("");
  const [championship, setChampionship] = useState(false);
  const [acknowledged, setAcknowledged] = useState(false);
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");

  const requiresAcknowledgement = useMemo(
    () =>
      member.membership_status === "renewal_required" ||
      member.membership_status === "not_member",
    [member.membership_status],
  );

  function applySingleBayToAll(value: string) {
    setD1(value);
    setD2(value);
    setD3(value);
    setD4(value);
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setErrorMessage("");

    if (requiresAcknowledgement && !acknowledged) {
      setErrorMessage("Acknowledge the membership warning before continuing.");
      return;
    }

    setBusy(true);
    const supabase = createClient();
    const { data, error } = await supabase.rpc("add_late_entry_and_sign_in", {
      p_event_id: eventId,
      p_member_id: member.member_id,
      p_target_type: targetType,
      p_distance: distance,
      p_shooting_class: shootingClass,
      p_position: position || null,
      p_d1: optionalBay(d1),
      p_d2: optionalBay(d2),
      p_d3: optionalBay(d3),
      p_d4: optionalBay(d4),
      p_championship_score_eligible: championship,
      p_membership_warning_acknowledged: acknowledged,
      p_notes: notes || null,
    });
    setBusy(false);

    if (error) {
      setErrorMessage(error.message);
      return;
    }

    const result = data as LateEntryResult;
    if (
      result.outcome !== "late_entry_signed_in" &&
      result.outcome !== "late_entry_signed_in_with_warning"
    ) {
      setErrorMessage(result.message || "The late entry could not be added.");
      return;
    }

    await onCompleted(result);
  }

  return (
    <section className="result warning">
      <div className="result-title">ADD LATE ENTRY</div>
      <div className="person">{member.competitor_name}</div>
      <div className="muted">WASRA {member.wasra_number}</div>

      <form onSubmit={submit}>
        <div className="facts">
          <label className="field">
            <span>Target type</span>
            <select value={targetType} onChange={(e) => setTargetType(e.target.value as "E" | "P")}>
              <option value="E">Electronic</option>
              <option value="P">Paper</option>
            </select>
          </label>

          <label className="field">
            <span>Distance</span>
            <select value={distance} onChange={(e) => setDistance(e.target.value)}>
              <option value="50m">50m</option>
              <option value="90m">90m</option>
            </select>
          </label>

          <label className="field">
            <span>Shooting class</span>
            <select value={shootingClass} onChange={(e) => setShootingClass(e.target.value)}>
              {CLASS_OPTIONS.map((value) => <option value={value} key={value}>{value}</option>)}
            </select>
          </label>

          <label className="field">
            <span>Position</span>
            <select value={position} onChange={(e) => setPosition(e.target.value)}>
              <option value="Prone">Prone</option>
              <option value="Bench">Bench</option>
            </select>
          </label>
        </div>

        <div className="field">
          <span>Quick bay assignment</span>
          <input
            type="number"
            min="1"
            max="99"
            placeholder="Enter one bay for D1 to D4"
            onChange={(e) => applySingleBayToAll(e.target.value)}
          />
        </div>

        <div className="grid">
          {[d1, d2, d3, d4].map((value, index) => {
            const setters = [setD1, setD2, setD3, setD4];
            return (
              <label className="bay" key={index}>
                D{index + 1}
                <input
                  type="number"
                  min="1"
                  max="99"
                  value={value}
                  onChange={(e) => setters[index](e.target.value)}
                  style={{ width: "100%", marginTop: 6, textAlign: "center" }}
                />
              </label>
            );
          })}
        </div>

        <label className="field">
          <span>Notes, optional</span>
          <input value={notes} onChange={(e) => setNotes(e.target.value)} />
        </label>

        <label className="field">
          <input type="checkbox" checked={championship} onChange={(e) => setChampionship(e.target.checked)} />{" "}
          Championship score eligible
        </label>

        {requiresAcknowledgement ? (
          <label className="field">
            <input type="checkbox" checked={acknowledged} onChange={(e) => setAcknowledged(e.target.checked)} />{" "}
            I acknowledge the membership warning
          </label>
        ) : null}

        {errorMessage !== "" ? <p className="error-text">{errorMessage}</p> : null}

        <div className="actions">
          <button className="primary" type="submit" disabled={busy}>
            {busy ? "Adding..." : "Add to event and sign in"}
          </button>
          <button className="secondary" type="button" onClick={onCancel} disabled={busy}>
            Cancel
          </button>
        </div>
      </form>
    </section>
  );
}
