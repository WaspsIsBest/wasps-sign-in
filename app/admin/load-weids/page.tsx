import BottomNav from "@/components/BottomNav";
import WeidBackfillApp from "@/components/WeidBackfillApp";

export default function Page() {
  return (
    <div className="shell">
      <header className="topbar">
        <div className="brand">WASPS Event Administration</div>
      </header>
      <WeidBackfillApp /><BottomNav active="other" />
    </div>
  );
}
