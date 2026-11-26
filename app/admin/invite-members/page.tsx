import BottomNav from "@/components/BottomNav";
import InviteMembersApp from "@/components/InviteMembersApp";

export default function Page() {
  return (
    <div className="shell">
      <header className="topbar">
        <div className="brand">WASPS Event Administration</div>
      </header>
      <InviteMembersApp /><BottomNav active="other" />
    </div>
  );
}
