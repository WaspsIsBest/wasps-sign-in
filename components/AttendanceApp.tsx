"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import Header from "./Header";
import BottomNav from "./BottomNav";
import SignInReportButton from "./SignInReportButton";

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
};

export default function AttendanceApp() {
  const router = useRouter();
  const [rows, setRows] = useState<RosterRow[]>([]);
  const [eventName, setEventName] = useState("Loading event");
  const [eventDate, setEventDate] = useState("");
  const [eventId, setEventId] = useState<number | null>(null);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<"all" | "signed" | "waiting">("all");
  const [loadError, setLoadError] = useState("");
  const [eventId, setEventId] = useState<number | null>(null);

  const load = useCallback(async () => {
    const supabase = createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      router.replace("/login");
      return;
    }

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
      return;
    }

    const event = (events?.[0] ?? null) as EventRow | null;
    if (!event) {
    setEventId(null);
    setEventName("No open event");
    setEventDate("");
    setRows([]);
    return;
    }
    setEventId(event.id);
    setEventName(event.name ?? "WASPS Weekly Event");
    setEventDate(event.event_date);

    const { data, error } = await supabase
      .from("app_sign_in_roster")
      .select("*")
      .eq("event_id", event.id)
      .order("competitor_name");

    if (error) {
      setLoadError(error.message);
      return;
    }

    setLoadError("");
    setRows((data ?? []) as RosterRow[]);
  }, [router]);

  useEffect(() => {
    void load();
  }, [load]);

  const signedCount = rows.filter((row) => row.signed_in_at !== null).length;
  const waitingCount = rows.length - signedCount;
  const search = query.trim().toLowerCase();

  const shown = rows.filter((row) => {
    const statusMatches =
      filter === "all" ||
      (filter === "signed" ? row.signed_in_at !== null : row.signed_in_at === null);
    const searchMatches = `${row.competitor_name} ${row.wasra_number}`
      .toLowerCase()
      .includes(search);
    return statusMatches && searchMatches;
  });

  return (
    <div className="shell" id="top">
      <Header eventName={eventName} eventDate={eventDate} />
      <main className="main">
       <div className="section-head">
     <h2>Attendance</h2>

     <SignInReportButton
    eventId={eventId}
    eventDate={eventDate}
     />
</div>
        {loadError !== "" ? <div className="result error">{loadError}</div> : null}
        <div className="toolbar">
          <button className="secondary" onClick={() => setFilter("all")}>All ({rows.length})</button>
          <button className="secondary" onClick={() => setFilter("signed")}>Signed in ({signedCount})</button>
          <button className="secondary" onClick={() => setFilter("waiting")}>Waiting ({waitingCount})</button>
        </div>
        <input className="search" placeholder="Search name or WASRA" value={query} onChange={(event) => setQuery(event.target.value)} />
        <div className="list">
          {shown.map((row) => (
            <div className="row" key={row.weekly_entry_id}>
              <div className="row-main">
                <div className="row-name">{row.competitor_name}</div>
                <div className="row-meta">WASRA {row.wasra_number} • Bays {[row.d1,row.d2,row.d3,row.d4].map((bay)=>bay??"–").join("/")}</div>
                <div className="row-meta">{[row.volunteer_role,row.volunteer_detail].filter(Boolean).join(" • ")}</div>
              </div>
              <div className={`status ${row.signed_in_at ? "good" : "wait"}`}>{row.signed_in_at ? "SIGNED IN" : "WAITING"}</div>
            </div>
          ))}
        </div>
      </main>
      <BottomNav active="attendance" />
    </div>
  );
}
