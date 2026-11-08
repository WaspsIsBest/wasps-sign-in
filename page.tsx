import EventAllocationApp from "@/components/EventAllocationApp";

export default function Page() {
  return (
    <div className="shell">
      <header className="topbar">
        <div className="brand">WASPS Event Administration</div>
      </header>
      <EventAllocationApp />
    </div>
  );
}
