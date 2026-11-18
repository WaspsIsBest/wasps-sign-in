import BottomNav from "@/components/BottomNav";
import WeidExportApp from "@/components/WeidExportApp";

export default function Page() {
  return (
    <div className="shell">
      <header className="topbar">
        <div className="brand">WASPS Event Administration</div>
      </header>
      <WeidExportApp />
      <BottomNav active="other" />
    </div>
  );
}
