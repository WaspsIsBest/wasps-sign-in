import Link from "next/link";
export default function BottomNav({active}:{active:"scan"|"attendance"}){
 return <nav className="bottom-nav"><Link className={`nav-link ${active==="scan"?"active":""}`} href="/sign-in">Scan</Link><Link className={`nav-link ${active==="attendance"?"active":""}`} href="/attendance">Attendance</Link><a className="nav-link" href="#top">Top</a></nav>;
}
