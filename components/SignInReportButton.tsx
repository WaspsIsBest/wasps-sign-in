"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";

type Props = {
  eventId: number | null;
  eventDate: string;
};

type ReportRow = {
  first_name: string;
  surname: string;
  fal: string;
};

function csvCell(value: string) {
  return `"${String(value ?? "").replaceAll('"', '""')}"`;
}

export default function SignInReportButton({ eventId, eventDate }: Props) {
  const [isAdmin, setIsAdmin] = useState(false);
  const [busy, setBusy] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");

  useEffect(() => {
    async function checkRole() {
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

      setIsAdmin(Boolean(data?.is_active && data.role === "admin"));
    }

    void checkRole();
  }, []);

  async function downloadReport() {
    if (eventId === null) return;

    setBusy(true);
    setErrorMessage("");

    const supabase = createClient();
    const { data, error } = await supabase.rpc("get_sign_in_report", {
      p_event_id: eventId,
    });

    setBusy(false);

    if (error) {
      setErrorMessage(error.message);
      return;
    }

    const rows = (data ?? []) as ReportRow[];
    const lines = [
      ["First Name", "Surname", "FAL"].map(csvCell).join(","),
      ...rows.map((row) =>
        [row.first_name, row.surname, row.fal].map(csvCell).join(","),
      ),
    ];

    const blob = new Blob(["\uFEFF", lines.join("\r\n")], {
      type: "text/csv;charset=utf-8",
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `WASPS_SignIn_Report_${eventDate || "event"}.csv`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  }

  if (!isAdmin) return null;

  return (
    <div>
      <button
        className="primary"
        type="button"
        onClick={downloadReport}
        disabled={busy || eventId === null}
      >
        {busy ? "Preparing report..." : "Download sign-in report"}
      </button>
      {errorMessage !== "" ? (
        <p className="error-text">{errorMessage}</p>
      ) : null}
    </div>
  );
}
