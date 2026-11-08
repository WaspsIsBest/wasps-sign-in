import * as XLSX from "xlsx";
import type { ValidationIssue } from "@/lib/event-import/types";
import type { ParsedCsv, RawEntry } from "./types";

const MONTHS = [
  "jan", "feb", "mar", "apr", "may", "jun",
  "jul", "aug", "sep", "oct", "nov", "dec",
];

const text = (v: unknown) => String(v ?? "").trim();

const norm = (v: string) => v.toLowerCase().replace(/\s+/g, " ").trim();

function isoDate(y: number, m: number, d: number) {
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (
    dt.getUTCFullYear() !== y ||
    dt.getUTCMonth() !== m - 1 ||
    dt.getUTCDate() !== d
  ) {
    return "";
  }
  return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

// Australian data: "03/04/2026" is 3 April, never 4 March.
export function parseSessionDate(value: string): string {
  const s = value.trim();
  if (!s) return "";

  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) return isoDate(Number(m[1]), Number(m[2]), Number(m[3]));

  m = s.match(/^(\d{1,2})[\/\-. ]([A-Za-z]{3,}|\d{1,2})[\/\-. ,]+(\d{2,4})/);
  if (!m) return "";

  const month = /^[A-Za-z]/.test(m[2])
    ? MONTHS.indexOf(m[2].slice(0, 3).toLowerCase()) + 1
    : Number(m[2]);
  let year = Number(m[3]);
  if (year < 100) year += 2000;

  return isoDate(year, month, Number(m[1]));
}

function parseWasra(value: unknown): number | null {
  const s = text(value).replace(/\s+/g, "");
  if (!/^\d+$/.test(s)) return null;
  const n = Number(s);
  return Number.isSafeInteger(n) ? n : null;
}

type ColumnKey =
  | "eventDate"
  | "bookingId"
  | "targetType"
  | "distance"
  | "shootingClass"
  | "position"
  | "fname"
  | "surname"
  | "wasra"
  | "volunteerRole"
  | "sharingWith";

// TryBooking's headers are long and occasionally reworded, so match on the
// distinctive part of each header rather than the whole text.
const COLUMN_MATCHERS: Record<ColumnKey, (header: string) => boolean> = {
  eventDate: (h) => h.startsWith("session date"),
  bookingId: (h) => h === "booking id",
  targetType: (h) => h.includes("ticket data: target type"),
  distance: (h) => h.includes("ticket data: range distance"),
  shootingClass: (h) => h.includes("ticket data: shooting class"),
  position: (h) => h.includes("ticket data: position shooting from"),
  fname: (h) => h === "ticket data: first name",
  surname: (h) => h === "ticket data: surname",
  wasra: (h) => h.includes("current wasra membership number"),
  volunteerRole: (h) =>
    h.includes("i can assist with one of the following roles"),
  sharingWith: (h) => h.includes("sharing my bay with another member"),
};

const REQUIRED: ColumnKey[] = [
  "eventDate",
  "targetType",
  "distance",
  "shootingClass",
  "fname",
  "surname",
  "wasra",
];

const LABELS: Record<ColumnKey, string> = {
  eventDate: "Session Date",
  bookingId: "Booking ID",
  targetType: "Ticket Data: Target Type",
  distance: "Ticket Data: Range Distance",
  shootingClass: "Ticket Data: Shooting Class",
  position: "Ticket Data: Position Shooting From",
  fname: "Ticket Data: First Name",
  surname: "Ticket Data: Surname",
  wasra: "Current WASRA Membership Number",
  volunteerRole: "I Can Assist With One Of The Following Roles",
  sharingWith: "I'm Sharing My Bay With Another Member",
};

export async function parseEntryCsv(file: File): Promise<ParsedCsv> {
  const issues: ValidationIssue[] = [];

  // Read as text with raw:true so dates stay as typed. Letting the library
  // guess would read 03/04/2026 as 4 March.
  const content = await file.text();
  const workbook = XLSX.read(content, { type: "string", raw: true });
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  const records = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, {
    defval: "",
    raw: true,
  });

  if (!records.length) {
    throw new Error("The CSV has no rows.");
  }

  const headers = Object.keys(records[0]);
  const columns = {} as Record<ColumnKey, string | null>;

  (Object.keys(COLUMN_MATCHERS) as ColumnKey[]).forEach((key) => {
    columns[key] =
      headers.find((h) => COLUMN_MATCHERS[key](norm(h))) ?? null;
  });

  let missingRequired = false;
  (Object.keys(columns) as ColumnKey[]).forEach((key) => {
    if (columns[key]) return;
    if (REQUIRED.includes(key)) {
      missingRequired = true;
      issues.push({
        severity: "error",
        message: `Missing CSV column: ${LABELS[key]}`,
      });
    } else {
      issues.push({
        severity: "warning",
        message: `CSV column not found (treated as blank): ${LABELS[key]}`,
      });
    }
  });

  if (missingRequired) {
    return { rows: [], issues };
  }

  const get = (record: Record<string, unknown>, key: ColumnKey) => {
    const header = columns[key];
    return header ? record[header] : "";
  };

  const rows: RawEntry[] = records.map((record, index) => ({
    rowNumber: index + 2,
    eventDate: parseSessionDate(text(get(record, "eventDate"))),
    bookingId: text(get(record, "bookingId")),
    targetType: text(get(record, "targetType")),
    distance: text(get(record, "distance")),
    shootingClass: text(get(record, "shootingClass")),
    position: text(get(record, "position")),
    fname: text(get(record, "fname")),
    surname: text(get(record, "surname")),
    wasra: parseWasra(get(record, "wasra")),
    volunteerRole: text(get(record, "volunteerRole")),
    sharingWith: text(get(record, "sharingWith")),
  }));

  const unreadable = rows.filter((r) => !r.eventDate);
  if (unreadable.length) {
    issues.push({
      severity: "warning",
      message: `${unreadable.length} CSV row(s) have a session date that could not be read and were ignored (rows ${unreadable
        .slice(0, 10)
        .map((r) => r.rowNumber)
        .join(", ")}${unreadable.length > 10 ? ", ..." : ""}).`,
    });
  }

  return { rows, issues };
}

// The event date to pre-select: the soonest date on or after today, otherwise
// the most recent one in the file.
export function pickDefaultDate(dates: string[], todayIso: string): string {
  const sorted = [...dates].sort();
  return sorted.find((d) => d >= todayIso) ?? sorted[sorted.length - 1] ?? "";
}
