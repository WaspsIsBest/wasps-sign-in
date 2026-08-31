"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";

type ActivePage = "scan" | "attendance" | "events" | "import";

const navStyle = {
  display: "grid",
  gridTemplateColumns: "repeat(4, minmax(0, 1fr))",
  gap: "6px",
  padding: "6px",
  width: "100%",
} as const;

const linkStyle = {
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  minWidth: 0,
  minHeight: "38px",
  padding: "7px 4px",
  borderRadius: "10px",
  backgroundColor: "#edf3f9",
  color: "#082f49",
  fontSize: "14px",
  fontWeight: 700,
  lineHeight: 1.1,
  textAlign: "center",
  textDecoration: "none",
  whiteSpace: "nowrap",
} as const;

const activeLinkStyle = {
  ...linkStyle,
  backgroundColor: "#dce9f5",
  color: "#005a9c",
} as const;

export default function BottomNav({ active }: { active: ActivePage }) {
  const [canManageEvents, setCanManageEvents] = useState(false);

  useEffect(() => {
    async function loadRole() {
      const supabase = createClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();

      if (!user) return;

      const { data } = await supabase
        .from("user_profiles")
        .select("role,is_active")
        .eq("user_id", user.id)
        .maybeSingle();

      setCanManageEvents(
        Boolean(
          data?.is_active &&
            (data.role === "admin" || data.role === "organiser"),
        ),
      );
    }

    void loadRole();
  }, []);

  function styleFor(page: ActivePage) {
    return active === page ? activeLinkStyle : linkStyle;
  }

  return (
    <nav className="bottom-nav" style={navStyle}>
      <Link href="/sign-in" style={styleFor("scan")}>
        Scan
      </Link>

      <Link href="/attendance" style={styleFor("attendance")}>
        Attendance
      </Link>

      {canManageEvents ? (
        <>
          <Link href="/admin/events" style={styleFor("events")}>
            Events
          </Link>

          <Link href="/admin/import-event" style={styleFor("import")}>
            Import
          </Link>
        </>
      ) : (
        <a href="#top" style={linkStyle}>
          Top
        </a>
      )}
    </nav>
  );
}
