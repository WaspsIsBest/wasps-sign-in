import BottomNav from "@/components/BottomNav";
import ScoresAdminApp from "@/components/ScoresAdminApp";

export const metadata = { title: "WASPS Scores" };

export default function Page() {
  return (
    <div className="shell">
      <header className="topbar">
        <div className="brand">WASPS Scores</div>
      </header>
      <ScoresAdminApp /><BottomNav active="scores" />
    </div>
  );
}
