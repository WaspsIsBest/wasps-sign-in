import BottomNav from "@/components/BottomNav";
import StartListsApp from "@/components/StartListsApp";

export default function Page() {
  return (
    <div className="shell">
      <header className="topbar">
        <div className="brand">WASPS Event Administration</div>
      </header>
      <StartListsApp />
      <BottomNav active="other" />
    </div>
  );
}
