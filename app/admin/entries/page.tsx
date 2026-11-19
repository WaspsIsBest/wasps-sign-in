import BottomNav from "@/components/BottomNav";
import EntriesAdminApp from "@/components/EntriesAdminApp";

export default function Page() {
  return (
    <div className="shell">
      <header className="topbar">
        <div className="brand">WASPS Event Administration</div>
      </header>
      <EntriesAdminApp />
      <BottomNav active="other" />
    </div>
  );
}
