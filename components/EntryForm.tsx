"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";

type OpenEvent = {
  id: number;
  event_date: string;
  name: string | null;
  start_time: string | null;
};

type ClassOption = { source_shooting_class: string; distance: string };

type Received = { name: string; eventDate: string };

const POSITIONS = [
  { value: "Prone", label: "Prone" },
  { value: "Other position", label: "Another position (not eligible for championship scores)" },
];

const VOLUNTEER_ROLES = ["Range Officer", "Trainee Range Officer", "Visitor Assistant"];

const selectStyle = {
  width: "100%",
  padding: 13,
  border: "1px solid #5a5a5a",
  borderRadius: 9,
  background: "#000", color: "#fff",
  font: "inherit",
} as const;

function prettyDate(iso: string) {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString("en-AU", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

export default function EntryForm() {
  const supabase = useMemo(() => createClient(), []);

  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [events, setEvents] = useState<OpenEvent[]>([]);
  const [classes, setClasses] = useState<ClassOption[]>([]);

  const [eventId, setEventId] = useState("");
  const [isVisitor, setIsVisitor] = useState(false);
  const [wasra, setWasra] = useState("");
  const [firstName, setFirstName] = useState("");
  const [surname, setSurname] = useState("");
  const [targetType, setTargetType] = useState("");
  const [distance, setDistance] = useState("");
  const [shootingClass, setShootingClass] = useState("");
  const [position, setPosition] = useState("");
  const [volunteerRole, setVolunteerRole] = useState("");
  const [sharingWith, setSharingWith] = useState("");
  const [website, setWebsite] = useState(""); // honeypot

  const [busy, setBusy] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");
  const [received, setReceived] = useState<Received | null>(null);

  useEffect(() => {
    async function load() {
      const [ev, opt] = await Promise.all([
        supabase.rpc("list_open_events"),
        supabase.rpc("entry_options"),
      ]);

      if (ev.error || opt.error) {
        setLoadError(
          "The entry form could not be loaded. Please try again shortly.",
        );
        setLoading(false);
        return;
      }

      const list = (ev.data ?? []) as OpenEvent[];
      setEvents(list);
      if (list.length === 1) setEventId(String(list[0].id));
      setClasses(((opt.data?.classes ?? []) as ClassOption[]) || []);
      setLoading(false);
    }

    void load();
  }, [supabase]);

  const distances = useMemo(
    () => [...new Set(classes.map((c) => c.distance))],
    [classes],
  );

  const classOptions = useMemo(
    () =>
      classes
        .filter((c) => c.distance.toLowerCase() === distance.toLowerCase())
        .map((c) => c.source_shooting_class),
    [classes, distance],
  );

  const isBenchrest = shootingClass.toLowerCase().includes("benchrest");
  const selectedEvent = events.find((e) => String(e.id) === eventId);

  function resetForNextEntry() {
    setReceived(null);
    setErrorMessage("");
    setWasra("");
    setFirstName("");
    setSurname("");
    setSharingWith("");
    setVolunteerRole("");
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    setErrorMessage("");
    setBusy(true);

    try {
      const { data, error } = await supabase.rpc("submit_entry", {
        p_event_id: Number(eventId),
        p_is_visitor: isVisitor,
        p_wasra: isVisitor ? null : wasra.trim(),
        p_first_name: isVisitor ? firstName.trim() : "",
        p_surname: surname.trim(),
        p_target_type: targetType,
        p_distance: distance,
        p_shooting_class: shootingClass,
        p_position: isBenchrest ? "Benchrest" : position,
        p_volunteer_role: volunteerRole || null,
        p_sharing_with: sharingWith.trim() || null,
        p_website: website,
      });

      if (error) {
        setErrorMessage(
          "Your entry could not be sent. Check your connection and try again.",
        );
        return;
      }

      if (data?.outcome === "entry_received") {
        setReceived({
          name: data.name ?? (isVisitor ? `${firstName} ${surname}` : surname),
          eventDate: data.event_date ?? selectedEvent?.event_date ?? "",
        });
        return;
      }

      setErrorMessage(
        data?.message ?? "Your entry could not be saved. Please try again.",
      );
    } catch {
      setErrorMessage(
        "Your entry could not be sent. Check your connection and try again.",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="shell">
      <header className="topbar">
        <div className="brand">WASPS Weekly Event Entry</div>
        {selectedEvent ? (
          <div className="event-name">{prettyDate(selectedEvent.event_date)}</div>
        ) : null}
      </header>

      <main className="main">
        {loading ? <p className="muted">Loading...</p> : null}

        {loadError !== "" ? (
          <div className="result error">
            <strong>Sorry</strong>
            <p>{loadError}</p>
          </div>
        ) : null}

        {!loading && loadError === "" && events.length === 0 ? (
          <div className="result info">
            <strong>Entries are not open right now</strong>
            <p>
              There is no event taking entries at the moment. Please check
              back later or contact an organiser.
            </p>
          </div>
        ) : null}

        {received !== null ? (
          <div className="result success">
            <strong>Entry received</strong>
            <p>
              {received.name}
              {received.eventDate !== "" ? `, ${prettyDate(received.eventDate)}` : ""}
            </p>
            <p className="muted">
              You are entered. Bays are allocated by the organisers before the
              event.
            </p>
            <div className="actions">
              <button className="secondary" type="button" onClick={resetForNextEntry}>
                Enter someone else
              </button>
            </div>
          </div>
        ) : null}

        {!loading && loadError === "" && events.length > 0 && received === null ? (
          <form onSubmit={submit}>
            {events.length > 1 ? (
              <label className="field">
                <span>Event</span>
                <select
                  style={selectStyle}
                  value={eventId}
                  onChange={(e) => setEventId(e.target.value)}
                  required
                >
                  <option value="">Choose an event</option>
                  {events.map((e) => (
                    <option key={e.id} value={e.id}>
                      {prettyDate(e.event_date)}
                      {e.name ? ` - ${e.name}` : ""}
                    </option>
                  ))}
                </select>
              </label>
            ) : null}

            <div className="field">
              <span>I am a</span>
              <label style={{ display: "inline-block", marginRight: 18 }}>
                <input
                  type="radio"
                  name="who"
                  checked={!isVisitor}
                  onChange={() => setIsVisitor(false)}
                />{" "}
                WASRA member
              </label>
              <label style={{ display: "inline-block" }}>
                <input
                  type="radio"
                  name="who"
                  checked={isVisitor}
                  onChange={() => setIsVisitor(true)}
                />{" "}
                Visitor
              </label>
            </div>

            {!isVisitor ? (
              <>
                <label className="field">
                  <span>WASRA membership number</span>
                  <input
                    inputMode="numeric"
                    autoComplete="off"
                    value={wasra}
                    onChange={(e) => setWasra(e.target.value)}
                    required
                  />
                </label>
                <label className="field">
                  <span>Surname</span>
                  <input
                    autoComplete="family-name"
                    value={surname}
                    onChange={(e) => setSurname(e.target.value)}
                    required
                  />
                </label>
              </>
            ) : (
              <>
                <label className="field">
                  <span>First name</span>
                  <input
                    autoComplete="given-name"
                    value={firstName}
                    onChange={(e) => setFirstName(e.target.value)}
                    required
                  />
                </label>
                <label className="field">
                  <span>Surname</span>
                  <input
                    autoComplete="family-name"
                    value={surname}
                    onChange={(e) => setSurname(e.target.value)}
                    required
                  />
                </label>
              </>
            )}

            <label className="field">
              <span>Target type</span>
              <select
                style={selectStyle}
                value={targetType}
                onChange={(e) => setTargetType(e.target.value)}
                required
              >
                <option value="">Choose</option>
                <option value="Electronic">Electronic (all club championship scores must be on this system)</option>
                <option value="Paper">Paper</option>
              </select>
            </label>

            <label className="field">
              <span>Range distance</span>
              <select
                style={selectStyle}
                value={distance}
                onChange={(e) => {
                  setDistance(e.target.value);
                  setShootingClass("");
                }}
                required
              >
                <option value="">Choose</option>
                {distances.map((d) => (
                  <option key={d} value={d}>
                    {d}
                  </option>
                ))}
              </select>
            </label>

            <label className="field">
              <span>Shooting class</span>
              <select
                style={selectStyle}
                value={shootingClass}
                onChange={(e) => setShootingClass(e.target.value)}
                disabled={distance === ""}
                required
              >
                <option value="">{distance === "" ? "Choose a distance first" : "Choose"}</option>
                {classOptions.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </label>

            {shootingClass !== "" && !isBenchrest ? (
              <label className="field">
                <span>Position shooting from</span>
                <select
                  style={selectStyle}
                  value={position}
                  onChange={(e) => setPosition(e.target.value)}
                  required
                >
                  <option value="">Choose</option>
                  {POSITIONS.map((p) => (
                    <option key={p.value} value={p.value}>
                      {p.label}
                    </option>
                  ))}
                </select>
              </label>
            ) : null}

            <label className="field">
              <span>I can help as, optional</span>
              <select
                style={selectStyle}
                value={volunteerRole}
                onChange={(e) => setVolunteerRole(e.target.value)}
              >
                <option value="">Not volunteering</option>
                {VOLUNTEER_ROLES.map((r) => (
                  <option key={r} value={r}>
                    {r}
                  </option>
                ))}
              </select>
            </label>

            <label className="field">
              <span>Sharing a bay with, optional</span>
              <input
                value={sharingWith}
                maxLength={120}
                onChange={(e) => setSharingWith(e.target.value)}
              />
              <small className="muted">
                Enter their full name. They must enter as well.
              </small>
            </label>

            {/* Honeypot: hidden from people, tempting to bots. */}
            <div
              aria-hidden="true"
              style={{ position: "absolute", left: "-10000px", height: 0, overflow: "hidden" }}
            >
              <label>
                Website
                <input
                  tabIndex={-1}
                  autoComplete="off"
                  value={website}
                  onChange={(e) => setWebsite(e.target.value)}
                />
              </label>
            </div>

            {errorMessage !== "" ? (
              <p className="error-text" role="alert">
                {errorMessage}
              </p>
            ) : null}

            <div className="actions">
              <button
                className="primary full"
                type="submit"
                disabled={busy || eventId === ""}
              >
                {busy ? "Sending..." : "Submit entry"}
              </button>
            </div>
          </form>
        ) : null}
      </main>
    </div>
  );
}
