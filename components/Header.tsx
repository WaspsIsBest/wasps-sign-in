"use client";
import { createClient } from "@/lib/supabase/client";
import { useRouter } from "next/navigation";
export default function Header({ eventName, eventDate }:{eventName:string;eventDate:string}){
 const router=useRouter();
 async function logout(){ await createClient().auth.signOut(); router.replace("/login"); router.refresh(); }
 return <header className="topbar"><div className="toprow"><div><div className="brand">WASPS</div><div className="event-name">{eventName} • {eventDate}</div></div><div><span className="open-pill">EVENT OPEN</span> <button className="secondary" onClick={logout}>Sign out</button></div></div></header>;
}
