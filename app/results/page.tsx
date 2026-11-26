import BottomNav from "@/components/BottomNav";
import WeeklyResultsApp from "@/components/WeeklyResultsApp";

export const metadata = { title: "WASPS Results" };

export default function Page() {
  return (
    <div className="shell">
      <header className="topbar">
        <div className="brand">WASPS Results</div>
      </header>
      <WeeklyResultsApp /><BottomNav active="results" />
    </div>
  );
}
