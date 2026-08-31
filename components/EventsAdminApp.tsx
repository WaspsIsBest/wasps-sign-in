"use client";

import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";

type CalendarStatus = "scheduled" | "open" | "closed" | "finalised" | "cancelled";
type EventType =
  | "weekly_competition"
  | "friday_competition"
  | "special_competition"
  | "practice"
  | "test";

type EventRow = {
  id: number;
  event_date: string;
  name: string;
  event_type: EventType;
  calendar_status: CalendarStatus;
  status: string;
  sign_in_open: boolean;
  is_active_event: boolean;
  is_test: boolean;
  start_time: string | null;
  end_time: string | null;
  nominations_required: boolean;
  assignments_required: boolean;
  assignments_imported: boolean;
  volunteers_imported: boolean;
  allow_walk_ins: boolean;
  allow_visitors: boolean;
  discipline: string | null;
  location_name: string | null;
  updated_at: string;
};

type ActionResult = {
  outcome: string;
  message: string;
  event_id?: number;
  event_date?: string;
  name?: string;
};

const EVENT_TYPES: Array<{ value: EventType; label: string }> = [
  { value: "weekly_competition", label: "Weekly competition" },
  { value: "friday_competition", label: "Friday competition" },
  { value: "special_competition", label: "Special competition" },
  { value: "practice", label: "Practice" },
  { value: "test", label: "Test event" },
];

function eventTypeLabel(value: EventType) {
  return EVENT_TYPES.find((item) => item.value === value)?.label ?? value.replaceAll("_", " ");
}

function calendarDate(value: string) {
  const [year, month, day] = value.split("-");
  if (!year || !month || !day) return value;
  return `${day}/${month}/${year}`;
}

function shortTime(value: string | null) {
  return value ? value.slice(0, 5) : "";
}

export default function EventsAdminApp() {
  const [allowed, setAllowed] = useState<boolean | null>(null);
  const [events, setEvents] = useState<EventRow[]>([]);
  const [filter, setFilter] = useState<"upcoming" | "open" | "history" | "all">("upcoming");
  const [showCreate, setShowCreate] = useState(false);
  const [busyEventId, setBusyEventId] = useState<number | null>(null);
  const [pageBusy, setPageBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [errorMessage, setErrorMessage] = useState("");

  const [eventDate, setEventDate] = useState("");
  const [eventName, setEventName] = useState("WASPS Friday Competition");
  const [eventType, setEventType] = useState<EventType>("friday_competition");
  const [startTime, setStartTime] = useState("18:30");
  const [endTime, setEndTime] = useState("21:30");
  const [discipline, setDiscipline] = useState("Target Rifle");
  const [locationName, setLocationName] = useState("WASPS Range");
  const [description, setDescription] = useState("");
  const [makeActive, setMakeActive] = useState(true);

  const loadEvents = useCallback(async () => {
    const supabase = createClient();
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
      window.location.href = "/login";
      return;
    }

    const { data: profile, error: profileError } = await supabase
      .from("user_profiles")
      .select("role,is_active")
      .eq("user_id", user.id)
      .maybeSingle();

    if (profileError) {
      setErrorMessage(profileError.message);
      setAllowed(false);
      return;
    }

    const canManage = Boolean(
      profile?.is_active && (profile.role === "admin" || profile.role === "organiser"),
    );
    setAllowed(canManage);
    if (!canManage) return;

    const { data, error } = await supabase
      .from("events")
      .select(
        "id,event_date,name,event_type,calendar_status,status,sign_in_open,is_active_event,is_test,start_time,end_time,nominations_required,assignments_required,assignments_imported,volunteers_imported,allow_walk_ins,allow_visitors,discipline,location_name,updated_at",
      )
      .order("event_date", { ascending: false })
      .order("id", { ascending: false });

    if (error) {
      setErrorMessage(error.message);
      return;
    }

    setEvents((data ?? []) as EventRow[]);
  }, []);

  useEffect(() => {
    void loadEvents();
  }, [loadEvents]);

  const today = new Date();
  const localToday = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;

  const shownEvents = useMemo(() => {
    return events.filter((event) => {
      if (filter === "all") return true;
      if (filter === "open") return event.sign_in_open || event.is_active_event;
      if (filter === "history") {
        return event.event_date < localToday || ["closed", "finalised", "cancelled"].includes(event.calendar_status);
      }
      return event.event_date >= localToday && !["finalised", "cancelled"].includes(event.calendar_status);
    });
  }, [events, filter, localToday]);

  function resetCreateForm() {
    setEventDate("");
    setEventName("WASPS Friday Competition");
    setEventType("friday_competition");
    setStartTime("18:30");
    setEndTime("21:30");
    setDiscipline("Target Rifle");
    setLocationName("WASPS Range");
    setDescription("");
    setMakeActive(true);
  }

  function changeEventType(value: EventType) {
    setEventType(value);
    const label = EVENT_TYPES.find((item) => item.value === value)?.label ?? "WASPS Event";
    setEventName(`WASPS ${label.replace(/^./, (letter) => letter.toUpperCase())}`);
  }

  async function createEvent(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPageBusy(true);
    setMessage("");
    setErrorMessage("");

    const supabase = createClient();
    const { data, error } = await supabase.rpc("create_calendar_event", {
      p_event_date: eventDate,
      p_name: eventName.trim(),
      p_event_type: eventType,
      p_start_time: startTime || null,
      p_end_time: endTime || null,
      p_description: description.trim() || null,
      p_discipline: discipline.trim() || null,
      p_location_name: locationName.trim() || null,
      p_make_active: makeActive,
    });

    setPageBusy(false);
    if (error) {
      setErrorMessage(error.message);
      return;
    }

    const result = data as ActionResult;
    if (result.outcome !== "event_created") {
      setErrorMessage(result.message || "The event could not be created.");
      return;
    }

    setMessage(result.message);
    setShowCreate(false);
    resetCreateForm();
    await loadEvents();
  }

  async function runEventAction(
    eventId: number,
    functionName: "set_active_event" | "set_event_sign_in_state",
    open?: boolean,
  ) {
    setBusyEventId(eventId);
    setMessage("");
    setErrorMessage("");
    const supabase = createClient();
    const args = functionName === "set_active_event"
      ? { p_event_id: eventId }
      : { p_event_id: eventId, p_open: Boolean(open) };
    const { data, error } = await supabase.rpc(functionName, args);
    setBusyEventId(null);

    if (error) {
      setErrorMessage(error.message);
      return;
    }

    const result = data as ActionResult;
    if (["not_authorised", "event_not_found", "event_not_selectable", "event_locked"].includes(result.outcome)) {
      setErrorMessage(result.message);
      return;
    }

    setMessage(result.message);
    await loadEvents();
  }

  if (allowed === null) {
    return <main className="main"><p>Checking permissions...</p></main>;
  }

  if (!allowed) {
    return (
      <main className="main">
        <h2>Not authorised</h2>
        <p>Only administrators and organisers can manage calendar events.</p>
        <Link href="/sign-in">Return to sign-in</Link>
      </main>
    );
  }

  return (
    <main className="main" id="top">
      <div className="section-head">
        <div>
          <h2>Calendar Events</h2>
          <p className="muted">Create, select, open, close and review WASPS events.</p>
        </div>
        <button className="primary" type="button" onClick={() => setShowCreate((value) => !value)}>
          {showCreate ? "Cancel" : "Create event"}
        </button>
      </div>

      {errorMessage !== "" ? <section className="result error"><strong>Error</strong><p>{errorMessage}</p></section> : null}
      {message !== "" ? <section className="result success"><strong>Completed</strong><p>{message}</p></section> : null}

      {showCreate ? (
        <form className="result info" onSubmit={createEvent}>
          <div className="result-title">CREATE CALENDAR EVENT</div>
          <div className="facts">
            <label className="field">
              <span>Event date</span>
              <input type="date" value={eventDate} onChange={(e) => setEventDate(e.target.value)} required />
            </label>
            <label className="field">
              <span>Event type</span>
              <select value={eventType} onChange={(e) => changeEventType(e.target.value as EventType)}>
                {EVENT_TYPES.map((item) => <option value={item.value} key={item.value}>{item.label}</option>)}
              </select>
            </label>
          </div>

          <label className="field">
            <span>Event name</span>
            <input value={eventName} onChange={(e) => setEventName(e.target.value)} required />
          </label>

          <div className="facts">
            <label className="field">
              <span>Start time</span>
              <input type="time" value={startTime} onChange={(e) => setStartTime(e.target.value)} />
            </label>
            <label className="field">
              <span>End time</span>
              <input type="time" value={endTime} onChange={(e) => setEndTime(e.target.value)} />
            </label>
            <label className="field">
              <span>Discipline</span>
              <input value={discipline} onChange={(e) => setDiscipline(e.target.value)} />
            </label>
            <label className="field">
              <span>Location</span>
              <input value={locationName} onChange={(e) => setLocationName(e.target.value)} />
            </label>
          </div>

          <label className="field">
            <span>Description, optional</span>
            <input value={description} onChange={(e) => setDescription(e.target.value)} />
          </label>

          <label className="field">
            <input type="checkbox" checked={makeActive} onChange={(e) => setMakeActive(e.target.checked)} />{" "}
            Make active and open sign-in immediately
          </label>

          <div className="actions">
            <button className="primary" type="submit" disabled={pageBusy}>
              {pageBusy ? "Creating..." : "Create event"}
            </button>
            <button className="secondary" type="button" onClick={() => setShowCreate(false)} disabled={pageBusy}>Cancel</button>
          </div>
        </form>
      ) : null}

      <div className="toolbar">
        <button className="secondary" type="button" onClick={() => setFilter("upcoming")}>Upcoming</button>
        <button className="secondary" type="button" onClick={() => setFilter("open")}>Open</button>
        <button className="secondary" type="button" onClick={() => setFilter("history")}>History</button>
        <button className="secondary" type="button" onClick={() => setFilter("all")}>All ({events.length})</button>
      </div>

      <div className="list">
        {shownEvents.map((event) => {
          const busy = busyEventId === event.id;
          const locked = event.calendar_status === "finalised" || event.calendar_status === "cancelled";
          return (
            <section className={`result ${event.is_active_event ? "success" : "info"}`} key={event.id}>
              <div className="section-head">
                <div>
                  <div className="result-title">
                    {event.is_active_event ? "ACTIVE EVENT" : event.calendar_status.toUpperCase()}
                  </div>
                  <div className="person">{event.name}</div>
                  <div className="muted">
                    {calendarDate(event.event_date)} • {eventTypeLabel(event.event_type)}
                    {event.start_time ? ` • ${shortTime(event.start_time)}` : ""}
                  </div>
                </div>
                <div className={`status ${event.sign_in_open ? "good" : "wait"}`}>
                  {event.sign_in_open ? "SIGN-IN OPEN" : "SIGN-IN CLOSED"}
                </div>
              </div>

              <div className="facts">
                <div className="fact"><small>ASSIGNMENTS</small>{event.assignments_required ? (event.assignments_imported ? "Imported" : "Required") : "Not required"}</div>
                <div className="fact"><small>WALK-INS</small>{event.allow_walk_ins ? "Allowed" : "Not allowed"}</div>
                <div className="fact"><small>VISITORS</small>{event.allow_visitors ? "Allowed" : "Not allowed"}</div>
                <div className="fact"><small>LOCATION</small>{event.location_name || "Not set"}</div>
              </div>

              <div className="actions">
                {!event.is_active_event && !locked ? (
                  <button className="secondary" type="button" disabled={busy} onClick={() => runEventAction(event.id, "set_active_event")}>
                    {busy ? "Working..." : "Make active"}
                  </button>
                ) : null}

                {!event.sign_in_open && !locked ? (
                  <button className="primary" type="button" disabled={busy} onClick={() => runEventAction(event.id, "set_event_sign_in_state", true)}>
                    Open sign-in
                  </button>
                ) : null}

                {event.sign_in_open ? (
                  <button className="danger" type="button" disabled={busy} onClick={() => runEventAction(event.id, "set_event_sign_in_state", false)}>
                    Close sign-in
                  </button>
                ) : null}

                {event.is_active_event && event.sign_in_open ? <Link className="primary" href="/sign-in">Open scan</Link> : null}
                <Link className="secondary" href="/attendance">Attendance</Link>
                {event.assignments_required && !event.assignments_imported ? <Link className="secondary" href="/admin/import-event">Import assignments</Link> : null}
              </div>
            </section>
          );
        })}

        {shownEvents.length === 0 ? <section className="result info"><p>No events match this filter.</p></section> : null}
      </div>
    </main>
  );
}
