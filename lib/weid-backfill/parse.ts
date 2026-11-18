import * as XLSX from "xlsx";

export type Row = {
  weid: number | null;
  event_date: string | null;
  wasra: number | null;
  name: string;
  target_type: string;
  distance: string;
  cscore: string;
  d1: number | null;
  d2: number | null;
  d3: number | null;
  d4: number | null;
};

function num(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function isoDate(v: unknown): string | null {
  if (v === null || v === undefined || v === "") return null;
  if (typeof v === "number") {
    const d = new Date(Date.UTC(1899, 11, 30) + Math.round(v) * 86400000);
    return d.toISOString().slice(0, 10);
  }
  const s = String(v).trim();
  const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  const dmy = /^(\d{1,2})\/(\d{1,2})\/(\d{4})/.exec(s);
  if (dmy) return `${dmy[3]}-${dmy[2].padStart(2, "0")}-${dmy[1].padStart(2, "0")}`;
  return null;
}

export function readRows(buffer: ArrayBuffer): Row[] {
  const wb = XLSX.read(buffer, { type: "array" });
  const sheet = wb.Sheets[wb.SheetNames[0]];
  const raw = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: null });
  const rows: Row[] = [];
  for (const r of raw) {
    const date = isoDate(r.EventDate);
    const wasra = num(r.FKMEMID);
    // Blank placeholder rows in Access (no date, no member) are ignored.
    if (!date && !wasra) continue;
    rows.push({
      // The WeeklyEntryID column is the WEID.
      weid: num(r.WeeklyEntryID),
      event_date: date,
      wasra,
      name: String(r.CName ?? ""),
      target_type: String(r.TargetType ?? ""),
      distance: String(r.Distance ?? ""),
      cscore: String(r.CScore ?? ""),
      d1: num(r.D1),
      d2: num(r.D2),
      d3: num(r.D3),
      d4: num(r.D4),
    });
  }
  return rows;
}
