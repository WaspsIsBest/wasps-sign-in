import BottomNav from "@/components/BottomNav";
import ChampionshipApp from "@/components/ChampionshipApp";

export const metadata = {
  title: "WASPS 2026 Club Championship",
};

export default function Page() {
  return (
    <div className="shell">
      <header className="topbar">
        <div className="brand">WASPS Club Championship</div>
      </header>
      <ChampionshipApp /><BottomNav active="champ" />
    </div>
  );
}
