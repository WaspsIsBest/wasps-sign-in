"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";

type ActivePage = "scan" | "attendance" | "events" | "import";

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

  return (
    <nav className="bottom-nav">
      <Link
        className={`nav-link ${active === "scan" ? "active" : ""}`}
        href="/sign-in"
      >
        Scan
      </Link>

      <Link
        className={`nav-link ${active === "attendance" ? "active" : ""}`}
        href="/attendance"
      >
        Attendance
      </Link>

      {canManageEvents ? (
        <>
          <Link
            className={`nav-link ${active === "events" ? "active" : ""}`}
            href="/admin/events"
          >
            Events
          </Link>

          <Link
            className={`nav-link ${active === "import" ? "active" : ""}`}
            href="/admin/import-event"
          >
            Import
          </Link>
        </>
      ) : (
        <a className="nav-link" href="#top">
          Top
        </a>
      )}
    </nav>
  );
}
