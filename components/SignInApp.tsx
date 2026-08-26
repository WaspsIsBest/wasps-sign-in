"use client";

import { FormEvent, useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import Header from "./Header";
import BottomNav from "./BottomNav";
import LateEntryForm from "./LateEntryForm";

type ScanResult = {
  outcome: string;
  message: string;
  sign_in_id?: number;
  member_id?: number;
  wasra_number?: number;
  competitor_name?: string;
  signed_in_at?: string;
  firearms_authority_display?: string;
  membership_status?: string;
  target_type?: string;
  distance?: string;
  shooting_class?: string;
  position?: string;
  d1?: number | null;
  d2?: number | null;
  d3?: number | null;
  d4?: number | null;
  volunteer_role?: string | null;
  volunteer_detail?: string | null;
  warning_code?: string | null;
};

type RosterRow = {
  weekly_entry_id: number;
  event_id: number;
  wasra_number: number;
  competitor_name: string;
  d1: number | null;
  d2: number | null;
  d3: number | null;
  d4: number | null;
  volunteer_role: string | null;
  volunteer_detail: string | null;
  attendance_status: string;
  signed_in_at: string | null;
  warning_code: string | null;
};

type EventRow = {
  id: number;
  name: string | null;
  event_date: string;
  updated_at: string;
};
function formatMembershipStatus(status?: string) {
  switch (status) {
    case "current":
      return "Current";

    case "new_member":
      return "New member";

    case "renewal_required":
      return "Renewal required";

    case "not_member":
      return "Not a member";

    case "unknown":
    case undefined:
    case "":
      return "Unknown";

    default:
      return status
        .replaceAll("_", " ")
        .replace(/\b\w/g, (character) => character.toUpperCase());
  }
}
export default function SignInApp() {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [eventId, setEventId] = useState<number | null>(null);
  const [eventName, setEventName] = useState("Loading event");
  const [eventDate, setEventDate] = useState("");
  const [scan, setScan] = useState("");
  const [result, setResult] = useState<ScanResult | null>(null);
  const [roster, setRoster] = useState<RosterRow[]>([]);
  const [busy, setBusy] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [showLateEntry, setShowLateEntry] = useState(false);

  const loadEventAndRoster = useCallback(async () => {
    const supabase = createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      router.replace("/login");
      return;
    }

    // The latest imported open event wins. updated_at is used intentionally,
    // allowing an older historical workbook to become the active test event.
    const { data: events, error: eventError } = await supabase
      .from("events")
      .select("id,name,event_date,updated_at")
      .eq("status", "open")
      .eq("sign_in_open", true)
      .order("updated_at", { ascending: false })
      .order("id", { ascending: false })
      .limit(1);

    if (eventError) {
      setLoadError(eventError.message);
      setEventName("Unable to load event");
      return;
    }

    const event = (events?.[0] ?? null) as EventRow | null;

    if (!event) {
      setEventId(null);
      setEventName("No open event");
      setEventDate("");
      setRoster([]);
      return;
    }

    setEventId(event.id);
    setEventName(event.name ?? "WASPS Weekly Event");
    setEventDate(event.event_date);
    setLoadError("");

    const { data, error } = await supabase
      .from("app_sign_in_roster")
      .select("*")
      .eq("event_id", event.id)
      .order("competitor_name");

    if (error) {
      setLoadError(error.message);
      return;
    }

    setRoster((data ?? []) as RosterRow[]);
  }, [router]);

  useEffect(() => {
    void loadEventAndRoster();
    inputRef.current?.focus();
  }, [loadEventAndRoster]);

  const signedCount = roster.filter((row) => row.signed_in_at !== null).length;
  const remainingCount = roster.length - signedCount;

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const value = scan.trim();
    if (!value || eventId === null) return;

    setBusy(true);
    const supabase = createClient();
    const { data, error } = await supabase.rpc("scan_member", {
      p_scanned_value: value,
      p_event_id: eventId,
    });

    setScan("");
    setBusy(false);
    setResult(
      error
        ? { outcome: "error", message: error.message }
        : (data as ScanResult),
    );

    await loadEventAndRoster();
    window.setTimeout(() => inputRef.current?.focus(), 0);
  }

  async function undo() {
    if (!result?.sign_in_id) return;

    setBusy(true);
    const supabase = createClient();
    const { data, error } = await supabase.rpc("undo_sign_in", {
      p_sign_in_id: result.sign_in_id,
    });
    setBusy(false);

    setResult(
      error
        ? { outcome: "error", message: error.message }
        : (data as ScanResult),
    );

    await loadEventAndRoster();
    inputRef.current?.focus();
  }

  function resultStyle() {
    if (!result) return "info";
    if (result.outcome === "signed_in") return "success";
    if (result.outcome === "signed_in_with_warning") return "warning";
    if (
      result.outcome === "already_signed_in" ||
      result.outcome === "member_not_entered"
    ) {
      return "info";
    }
    return "error";
  }

  const recent = roster
    .filter((row) => row.signed_in_at !== null)
    .sort((a, b) => (b.signed_in_at ?? "").localeCompare(a.signed_in_at ?? ""))
    .slice(0, 5);

  return (
    <div className="shell" id="top">
      <Header eventName={eventName} eventDate={eventDate} />

      <main className="main">
        {loadError !== "" ? (
          <section className="result error">
            <strong>Unable to load event</strong>
            <p>{loadError}</p>
          </section>
        ) : null}

        <div className="scan-label">Scan membership card</div>
        <form className="scan-form" onSubmit={submit}>
          <input
            ref={inputRef}
            className="scan-input"
            inputMode="numeric"
            autoComplete="off"
            placeholder="Scan card or enter WASRA number"
            value={scan}
            onChange={(event) => setScan(event.target.value)}
            disabled={busy || eventId === null}
          />
          <button className="primary" disabled={busy || eventId === null}>
            {busy ? "Working..." : "Sign in"}
          </button>
        </form>
        <div className="hint">Scanner ready • Press Enter after manual entry</div>

        {result ? (
          <section className={`result ${resultStyle()}`}>
            <div className="result-title">
              {result.outcome.replaceAll("_", " ").toUpperCase()}
            </div>
            {result.competitor_name ? (
              <>
                <div className="person">{result.competitor_name}</div>
                <div className="muted">WASRA {result.wasra_number}</div>
              </>
            ) : null}
            <p>{result.message}</p>
            {result.outcome === "member_not_entered" && result.member_id ? (
              <div className="actions">
                 <button
                   className="primary"
                   type="button"
                   onClick={() => setShowLateEntry(true)}
                 >
                   Add to event and sign in
                  </button>
                </div>
               ) : null}

            {result.competitor_name ? (
              <>
                <div className="facts">
                  <div className="fact">
                    <small>SHOOTING ENTRY</small>
                    {[
                      result.target_type === "E"
                        ? "Electronic"
                        : result.target_type === "P"
                        ? "Paper"
                        : "Not entered",
                
                      result.distance,
                      result.shooting_class,
                    ]
                      .filter(Boolean)
                      .join(" • ")}
                  </div>
                  <div className="fact">
                    <small>VOLUNTEER DUTY</small>
                    {[result.volunteer_role, result.volunteer_detail]
                      .filter(Boolean)
                      .join(" • ") || "None"}
                  </div>
                </div>
                <div className="grid">
                  {([1, 2, 3, 4] as const).map((detail) => (
                    <div className="bay" key={detail}>
                      D{detail}
                      <b>{result[`d${detail}`] ?? "–"}</b>
                    </div>
                  ))}
                </div>
                <div className="facts">
                  <div className="fact">
                    <small>FAL STATUS</small>
                    {result.firearms_authority_display ?? "Unknown"}
                  </div>
                  <div className="fact">
                    <small>MEMBERSHIP</small>
                    {formatMembershipStatus(result.membership_status)}
                  </div>
                </div>
              </>
            ) : null}

            {result.sign_in_id && result.outcome.startsWith("signed_in") ? (
              <div className="actions">
                <button className="danger" onClick={undo} disabled={busy}>
                  Undo sign-in
                </button>
              </div>
            ) : null}
          </section>
        ) : (
          <section className="result info">
            <div className="result-title">READY</div>
            <p>Waiting for the next membership card.</p>
          </section>
        )}

        <section className="stats">
          <div className="stat"><b>{signedCount}</b><span>SIGNED IN</span></div>
          <div className="stat"><b>{remainingCount}</b><span>REMAINING</span></div>
          <div className="stat"><b>{roster.length}</b><span>EXPECTED</span></div>
        </section>

        <div className="section-head">
          <h3>Recent sign-ins</h3>
          <a href="/attendance">View all</a>
        </div>

        <div className="list">
          {recent.map((row) => (
            <div className="row" key={row.weekly_entry_id}>
              <div className="row-main">
                <div className="row-name">{row.competitor_name}</div>
                <div className="row-meta">
                  WASRA {row.wasra_number} • Bays{" "}
                  {[row.d1, row.d2, row.d3, row.d4]
                    .map((bay) => bay ?? "–")
                    .join("/")}
                </div>
              </div>
              <div className="status good">SIGNED IN</div>
            </div>
          ))}
          {recent.length === 0 ? <p className="muted">No sign-ins yet.</p> : null}
        </div>
      </main>

      <BottomNav active="scan" />
    </div>
  );
}
