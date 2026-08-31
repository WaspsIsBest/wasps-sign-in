import EventsAdminApp from "@/components/EventsAdminApp";

export default function EventsAdminPage() {
  return (
    <div className="shell">
      <header className="topbar">
        <div className="toprow">
          <div>
            <div className="brand">WASPS Event Administration</div>
            <div className="event-name">Calendar and sign-in management</div>
          </div>
          <a className="secondary" href="/sign-in">
            Back to sign-in
          </a>
        </div>
      </header>
      <EventsAdminApp />
    </div>
  );
}
