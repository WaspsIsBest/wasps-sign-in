"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";

type Props = {
  eventId: number | null;
  eventDate: string;
};

type ReportRow = {
  report_type: string;
  attendance_date: string;
  first_name: string;
  surname: string;
  date_of_birth: string | null;
  firearm_authority_number: string;
  declaration_received: string;
};

function csvCell(value: string | null | undefined) {
  return `"${String(value ?? "").replaceAll('"', '""')}"`;
}

function displayDate(value: string | null | undefined) {
  if (!value) return "";
  const parts = value.split("-");
  return parts.length === 3 ? `${parts[2]}/${parts[1]}/${parts[0]}` : value;
}

export default function SignInReportButton({ eventId, eventDate }: Props) {
  const [isAdmin, setIsAdmin] = useState(false);
  const [busy, setBusy] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");

  useEffect(() => {
    async function checkRole() {
      const supabase = createClient();
      const { data: { user } } = await supabase.auth.getUser();
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
    const { data, error } = await supabase.rpc("get_wapol_attendance_report", {
      p_event_id: eventId,
    });

    setBusy(false);
    if (error) {
      setErrorMessage(error.message);
      return;
    }

    const rows = (data ?? []) as ReportRow[];
    const header = [
      "Report Type",
      "Date",
      "First Name",
      "Surname",
      "Date of Birth",
      "Firearm Authority Number",
      "Declaration Received",
    ];

    const lines = [
      header.map(csvCell).join(","),
      ...rows.map((row) =>
        [
          row.report_type,
          displayDate(row.attendance_date),
          row.first_name,
          row.surname,
          displayDate(row.date_of_birth),
          row.firearm_authority_number,
          row.declaration_received,
        ].map(csvCell).join(","),
      ),
    ];

    const blob = new Blob(["\uFEFF", lines.join("\r\n")], {
      type: "text/csv;charset=utf-8",
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `WASPS_WAPOL_Report_${eventDate || "event"}.csv`;
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
        {busy ? "Preparing report..." : "Download WA Police report"}
      </button>
      {errorMessage !== "" ? <p className="error-text">{errorMessage}</p> : null}
    </div>
  );
}
