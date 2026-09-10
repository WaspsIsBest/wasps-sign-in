import * as XLSX from "xlsx";
import type {
  ImportEntry,
  ImportPreview,
  ImportVolunteer,
  ValidationIssue,
} from "./types";

const required = [
  "EventDate",
  "BookingID",
  "TargetType",
  "Distance",
  "ShootingClass",
  "Fname",
  "Surname",
  "WASRA",
  "MCID",
  "FKCID",
  "WEID",
  "D1",
  "D2",
  "D3",
  "D4",
  "CScore",
];

const text = (v: unknown) => String(v ?? "").trim();

const num = (v: unknown) => {
  if (v === null || v === undefined || text(v) === "") return null;

  const n = Number(v);

  return Number.isFinite(n) ? Math.trunc(n) : null;
};

function iso(v: unknown) {
  // FIXED: Do NOT use toISOString() because it converts to UTC
  // and can shift Perth dates back one day.
  if (v instanceof Date && !isNaN(v.valueOf())) {
    const y = v.getFullYear();
    const m = String(v.getMonth() + 1).padStart(2, "0");
    const d = String(v.getDate()).padStart(2, "0");

    return `${y}-${m}-${d}`;
  }

  if (typeof v === "number") {
    const d = XLSX.SSF.parse_date_code(v);

    return `${d.y}-${String(d.m).padStart(2, "0")}-${String(
      d.d,
    ).padStart(2, "0")}`;
  }

  const s = text(v);
  
const m = s.match(
  /^(\d{1,2})[-/]([A-Za-z]{3}|\d{1,2})[-/](\d{

const months = [
  "jan",
  "feb",
  "mar",
  "apr",
  "may",
  "jun",
  "jul",
  "aug",
  "sep",
  "oct",
  "nov",
  "dec",
];

  

  const month = /^[A-Za-z]/.test(m[2])
    ? months.indexOf(m[2].toLowerCase()) + 1
    : Number(m[2]);

  let year = Number(m[3]);

  if (year < 100) {
    year += 2000;
  }

  return `${year}-${String(month).padStart(2, "0")}-${String(
    Number(m[1]),
  ).padStart(2, "0")}`;
}

async function read(file: File) {
  const buffer = await file.arrayBuffer();

  const workbook = XLSX.read(buffer, {
    type: "array",
    cellDates: true,
  });

  const sheet = workbook.Sheets[workbook.SheetNames[0]];

  return XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, {
    defval: null,
    raw: true,
  });
}

export async function parseEventFiles(
  bf: File,
  vf: File,
): Promise<ImportPreview> {
  const issues: ValidationIssue[] = [];

  const br = await read(bf);
  const vr = await read(vf);

  if (!br.length) {
    throw new Error("Bay workbook has no rows.");
  }

  for (const header of required) {
    if (!(header in br[0])) {
      issues.push({
        severity: "error",
        message: `Missing bay column: ${header}`,
      });
    }
  }

  const dates = [
    ...new Set(
      br
        .map((row) => iso(row.EventDate_norm ?? row.EventDate))
        .filter(Boolean),
    ),
  ];

  if (dates.length !== 1) {
    issues.push({
      severity: "error",
      message: "Bay rows must contain one event date.",
    });
  }

  const seen = new Set<string>();
  const entries: ImportEntry[] = [];

  br.forEach((row, index) => {
    const wasra = num(row.WASRA);
    const weid = text(row.WEID);

    const ticket = `event-${dates[0] || "unknown"}-${
      weid || wasra || index + 2
    }`;

    if (seen.has(ticket)) {
      issues.push({
        severity: "error",
        row: index + 2,
        message: `Duplicate identifier: ${ticket}`,
      });
    }

    seen.add(ticket);

    if (!wasra || wasra <= 0) {
      issues.push({
        severity: "error",
        row: index + 2,
        message: "Invalid WASRA number.",
      });
    }

    if (!text(row.Fname) || !text(row.Surname)) {
      issues.push({
        severity: "error",
        row: index + 2,
        message: "Name is required.",
      });
    }

    const bays = [row.D1, row.D2, row.D3, row.D4].map(num);

    bays.forEach((bay, bayIndex) => {
      if (bay !== null && (bay < 1 || bay > 99)) {
        issues.push({
          severity: "error",
          row: index + 2,
          message: `Invalid D${bayIndex + 1} bay: ${bay}`,
        });
      }
    });

    entries.push({
      source_booking_id: text(row.BookingID),
      source_ticket_number: ticket,
      weid,
      wasra_number: wasra || 0,
      first_name: text(row.Fname),
      surname: text(row.Surname),
      target_type: text(row.TargetType)
        .toLowerCase()
        .startsWith("electronic")
        ? "E"
        : "P",
      distance: text(row.Distance),
      shooting_class: text(row.ShootingClass),
      position: text(row.Position)
        .replace(/\s*\(.*/, "")
        .trim(),
      fkcid: num(row.FKCID) || 0,
      mcid: num(row.MCID) || 0,
      championship_score_eligible:
        text(row.CScore).toUpperCase() === "Y",
      volunteer_preference: text(row.VolunteerRole),
      sharing_with: text(row.SharingWith),
      d1: bays[0],
      d2: bays[1],
      d3: bays[2],
      d4: bays[3],
    });
  });

  const volunteers: ImportVolunteer[] = [];

  if (vr.length) {
    for (const header of ["Role", "D1", "D2", "D3", "D4"]) {
      if (!(header in vr[0])) {
        issues.push({
          severity: "error",
          message: `Missing volunteer column: ${header}`,
        });
      }
    }

    vr.forEach((row) => {
      const role = text(row.Role);

      for (const detail of [1, 2, 3, 4] as const) {
        const name = text(row[`D${detail}`]);

        if (
          role &&
          name &&
          name.toLowerCase() !== "not assigned"
        ) {
          volunteers.push({
            role,
            detail_number: detail,
            member_name: name,
          });
        }
      }
    });
  }

  return {
    eventDate: dates[0] || "",
    entries,
    volunteers,
    issues,
    bayCount: entries.reduce(
      (count, entry) =>
        count +
        [entry.d1, entry.d2, entry.d3, entry.d4].filter(
          (value) => value !== null,
        ).length,
      0,
    ),
  };
}
