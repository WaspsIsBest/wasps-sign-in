import * as XLSX from "xlsx";

// Reads a Meyton results export (CSV, semicolon or comma separated, or .xlsx)
// and matches each row to an entry of the chosen night.
//
// Columns are found by name, so the order does not matter. The names used by
// the Scheiben query are recognised (StartNr, SportpassID, TotalRing,
// TotalRing01, Rangliste, Zeitstempel) along with common alternatives.

export type MeytonRow = {
  line: number;
  startNr: number | null;
  sportpass: number | null;
  name: string;
  score: number | null; // decimal total when present, else whole total
  detail: number | null;
  list: string;
  shotAt: string | null;
};

export type SheetEntry = {
  weekly_entry_id: number;
  weid: number | null;
  wasra: number | null;
  name: string;
  distance: string;
  class_name: string;
  target_type: string;
  eligible: boolean;
  bays: Record<string, number> | null;
  scores: Record<string, { score: number; inners: number | null; source: string }> | null;
};

export type Matched = {
  entry: SheetEntry;
  detail: number;
  score: number;
  list: string;
  shotAt: string | null;
  previous: number | null;
  duplicates: number; // other rows for the same entry and detail (the highest is kept)
  note: string;
};

export type Problem = { row: MeytonRow; reason: string };

export type MatchResult = {
  matched: Matched[];
  problems: Problem[];
  columns: Record<string, string | null>;
  rowsRead: number;
};

const ALIASES: Record<string, string[]> = {
  startNr: ["startnr", "startnummer", "startno", "startnumber", "weid"],
  sportpass: ["sportpassid", "sportpass", "sportpassnr", "passnr", "wasra", "wasranumber", "memberid"],
  decimal: ["totalring01", "ring01", "zehntel", "totalzehntel", "decimal", "decimalscore", "totaldecimal"],
  whole: ["totalring", "ringe", "ring", "total", "result", "score"],
  list: ["rangliste", "ranglist", "wettbewerb", "disziplin", "event", "eventcode", "match"],
  detail: ["detail", "durchgang", "relay"],
  time: ["zeitstempel", "timestamp", "datum", "date", "time"],
  name: ["name", "nachname", "competitor", "shooter"],
};

const k = (h: string) => h.replace(/[^A-Za-z0-9]/g, "").toLowerCase();

function num(v: unknown): number | null {
  if (v === null || v === undefined) return null;
  const s = String(v).trim().replace(",", ".");
  if (s === "") return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

// Minimal CSV reader: detects ; , or tab, handles quotes.
function parseDelimited(text: string): string[][] {
  const clean = text.replace(/^﻿/, "");
  const first = clean.split(/\r?\n/, 1)[0] ?? "";
  const counts = [";", ",", "\t"].map((d) => [d, first.split(d).length] as const);
  const delim = counts.sort((a, b) => b[1] - a[1])[0][0];
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < clean.length; i++) {
    const c = clean[i];
    if (quoted) {
      if (c === '"' && clean[i + 1] === '"') { cell += '"'; i++; }
      else if (c === '"') quoted = false;
      else cell += c;
    } else if (c === '"') quoted = true;
    else if (c === delim) { row.push(cell); cell = ""; }
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && clean[i + 1] === "\n") i++;
      row.push(cell); cell = "";
      if (row.some((x) => x.trim() !== "")) rows.push(row);
      row = [];
    } else cell += c;
  }
  row.push(cell);
  if (row.some((x) => x.trim() !== "")) rows.push(row);
  return rows;
}

function toIsoTime(v: unknown): string | null {
  if (v === null || v === undefined || v === "") return null;
  if (typeof v === "number") {
    return new Date(Date.UTC(1899, 11, 30) + v * 86400000).toISOString();
  }
  const s = String(v).trim();
  let m = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{1,2}):(\d{2})(?::(\d{2}))?/.exec(s);
  if (m) return `${m[1]}-${m[2]}-${m[3]}T${m[4].padStart(2, "0")}:${m[5]}:${m[6] ?? "00"}+08:00`;
  m = /^(\d{1,2})[./](\d{1,2})[./](\d{4})[ T]+(\d{1,2}):(\d{2})(?::(\d{2}))?/.exec(s);
  if (m) return `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}T${m[4].padStart(2, "0")}:${m[5]}:${m[6] ?? "00"}+08:00`;
  return null;
}

// "261203WD3" -> 3 ; "D2" -> 2
export function detailFromList(list: string): number | null {
  const m = /WD\s*([1-4])\b/i.exec(list) ?? /(?:^|[^A-Za-z])D\s*([1-4])\b/i.exec(list);
  return m ? Number(m[1]) : null;
}

// "261203WD3" -> "2026-12-03"
export function dateFromList(list: string): string | null {
  const m = /^(\d{2})(\d{2})(\d{2})W/i.exec(list.trim());
  return m ? `20${m[1]}-${m[2]}-${m[3]}` : null;
}

export function readMeyton(buffer: ArrayBuffer, fileName: string): { rows: MeytonRow[]; columns: Record<string, string | null> } {
  let table: string[][];
  if (/\.xlsx?$/i.test(fileName)) {
    const wb = XLSX.read(buffer, { type: "array", cellDates: false });
    table = XLSX.utils.sheet_to_json<string[]>(wb.Sheets[wb.SheetNames[0]], { header: 1, raw: true, defval: "" })
      .map((r) => r.map((c) => (c === null || c === undefined ? "" : (c as unknown as string))));
  } else {
    let text = new TextDecoder("utf-8").decode(buffer);
    if (text.includes("�")) text = new TextDecoder("windows-1252").decode(buffer);
    table = parseDelimited(text);
  }
  if (table.length < 2) return { rows: [], columns: {} };

  const header = table[0].map((h) => k(String(h)));
  const columns: Record<string, string | null> = {};
  const idx: Record<string, number> = {};
  for (const [field, names] of Object.entries(ALIASES)) {
    let at = -1;
    for (const n of names) {
      at = header.indexOf(n);
      if (at >= 0) break;
    }
    idx[field] = at;
    columns[field] = at >= 0 ? String(table[0][at]) : null;
  }
  // "TotalRing" must not be mistaken for the decimal column and vice versa.
  if (idx.whole >= 0 && idx.whole === idx.decimal) idx.whole = -1;

  const cell = (r: unknown[], f: string) => (idx[f] >= 0 ? r[idx[f]] : undefined);
  const rows: MeytonRow[] = [];
  table.slice(1).forEach((r, i) => {
    const list = String(cell(r, "list") ?? "").trim();
    const dec = num(cell(r, "decimal"));
    const whole = num(cell(r, "whole"));
    rows.push({
      line: i + 2,
      startNr: num(cell(r, "startNr")),
      sportpass: num(cell(r, "sportpass")),
      name: String(cell(r, "name") ?? "").trim(),
      score: dec ?? whole,
      detail: num(cell(r, "detail")) ?? detailFromList(list),
      list,
      shotAt: toIsoTime(cell(r, "time")),
    });
  });
  return { rows, columns };
}

export function matchToNight(
  rows: MeytonRow[],
  entries: SheetEntry[],
  eventDate: string,
  fallbackDetail: number | null,
): Omit<MatchResult, "columns"> {
  const byWeid = new Map<number, SheetEntry>();
  const byWasra = new Map<number, SheetEntry[]>();
  for (const e of entries) {
    if (e.weid !== null) byWeid.set(e.weid, e);
    if (e.wasra !== null) byWasra.set(e.wasra, [...(byWasra.get(e.wasra) ?? []), e]);
  }

  const problems: Problem[] = [];
  const best = new Map<string, Matched>();

  for (const row of rows) {
    if (row.score === null) { problems.push({ row, reason: "No score" }); continue; }
    if (row.score <= 0) { problems.push({ row, reason: "Score is zero (did not shoot?)" }); continue; }
    const listDate = dateFromList(row.list);
    if (listDate && listDate !== eventDate) { problems.push({ row, reason: `Belongs to ${listDate}, not this night` }); continue; }

    let entry: SheetEntry | null = null;
    let note = "";
    if (row.startNr !== null && byWeid.has(row.startNr)) {
      entry = byWeid.get(row.startNr)!;
      if (row.sportpass !== null && entry.wasra !== null && entry.wasra !== row.sportpass) {
        note = `Sportpass ${row.sportpass} differs from entry's WASRA ${entry.wasra}`;
      }
    } else if (row.sportpass !== null) {
      const cand = byWasra.get(row.sportpass) ?? [];
      const electronic = cand.filter((c) => c.target_type === "E");
      const pick = electronic.length === 1 ? electronic : cand;
      if (pick.length === 1) { entry = pick[0]; note = "Matched by WASRA (StartNr not found)"; }
      else if (pick.length > 1) { problems.push({ row, reason: `WASRA ${row.sportpass} has ${pick.length} entries tonight; StartNr needed` }); continue; }
    }
    if (!entry) { problems.push({ row, reason: "No entry tonight with this StartNr/WASRA" }); continue; }

    let detail = row.detail;
    if (detail === null) {
      const bayDetails = Object.keys(entry.bays ?? {}).map(Number);
      if (bayDetails.length === 1) detail = bayDetails[0];
      else detail = fallbackDetail;
    }
    if (detail === null || detail < 1 || detail > 4) { problems.push({ row, reason: "Detail unknown" }); continue; }

    const key = `${entry.weekly_entry_id}|${detail}`;
    const prev = best.get(key);
    const score = Math.round(row.score * 100) / 100;
    if (prev) {
      prev.duplicates += 1;
      if (score > prev.score) { prev.score = score; prev.list = row.list; prev.shotAt = row.shotAt; }
      continue;
    }
    best.set(key, {
      entry, detail, score, list: row.list, shotAt: row.shotAt,
      previous: entry.scores?.[String(detail)]?.score ?? null,
      duplicates: 0, note,
    });
  }

  const matched = [...best.values()].sort(
    (a, b) => a.detail - b.detail || a.entry.name.localeCompare(b.entry.name),
  );
  return { matched, problems, rowsRead: rows.length };
}
