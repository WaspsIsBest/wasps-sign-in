import BottomNav from "@/components/BottomNav";
import MyScoresApp from "@/components/MyScoresApp";

export const metadata = { title: "WASPS My Scores" };

export default function Page() {
  return (
    <div className="shell">
      <header className="topbar">
        <div className="brand">WASPS My Scores</div>
      </header>
      <MyScoresApp /><BottomNav active="myscores" />
    </div>
  );
}
