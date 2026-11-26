import * as XLSX from "xlsx";

// Turns the Access WeeklyEntryT + ScoreT exports into one score per WEID and
// detail for load_history_scores(). Unlike the 2026 championship loader this
// keeps EVERY score (paper, non-championship, any date) so history is complete.

export type HistoryRow = {
  weid: number;
  detail: number;
  score: number;
  inners: number | null;
  class_name: string | null;
  distance: string | null;
};

export type HistoryResult = {
  rows: HistoryRow[];
  scoreRowsRead: number;
  noEntry: number;   // score rows with no WEID and no matching WASRA + date
  noScore: number;   // score rows without a usable score or detail
  firstNight: string | null;
  lastNight: string | null;
};

const CLASS_BY_FKCID: Record<number, string> = {
  1: "Sporter", 2: "Modified", 3: "F-Open", 14: "Benchrest",
  7: "Sporter", 8: "Modified", 9: "F-Open", 15: "Benchrest",
};

const key = (h: string) => h.replace(/[^A-Za-z0-9]/g, "").toLowerCase();

function num(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function isoDate(v: unknown): string | null {
  if (v === null || v === undefined || v === "") return null;
  if (typeof v === "number") {
    return new Date(Date.UTC(1899, 11, 30) + Math.round(v) * 86400000).toISOString().slice(0, 10);
  }
  const s = String(v).trim();
  const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  const dmy = /^(\d{1,2})\/(\d{1,2})\/(\d{4})/.exec(s);
  if (dmy) return `${dmy[3]}-${dmy[2].padStart(2, "0")}-${dmy[1].padStart(2, "0")}`;
  return null;
}

function sheetRows(buffer: ArrayBuffer): Record<string, unknown>[] {
  const wb = XLSX.read(buffer, { type: "array" });
  return XLSX.utils
    .sheet_to_json<Record<string, unknown>>(wb.Sheets[wb.SheetNames[0]], { defval: null })
    .map((r) => {
      const o: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(r)) o[key(k)] = v;
      return o;
    });
}

export function readHistory(weeklyBuffer: ArrayBuffer, scoreBuffer: ArrayBuffer): HistoryResult {
  type Entry = { weid: number; date: string | null; wasra: number | null; dist: string; cls: string | null };
  const entries = new Map<number, Entry>();
  const byWasraDate = new Map<string, number[]>();
  for (const r of sheetRows(weeklyBuffer)) {
    const weid = num(r.weeklyentryid);
    if (weid === null) continue;
    const fkcid = num(r.fkcid);
    const e: Entry = {
      weid,
      date: isoDate(r.eventdate),
      wasra: num(r.fkmemid),
      dist: String(r.distance ?? "").trim().toLowerCase(),
      cls: fkcid !== null ? CLASS_BY_FKCID[fkcid] ?? null : null,
    };
    entries.set(weid, e);
    if (e.wasra && e.date) {
      const k = `${e.wasra}|${e.date}`;
      byWasraDate.set(k, [...(byWasraDate.get(k) ?? []), weid]);
    }
  }

  const best = new Map<string, HistoryRow>();
  const nights: string[] = [];
  let noEntry = 0;
  let noScore = 0;
  const scoreRows = sheetRows(scoreBuffer);

  for (const r of scoreRows) {
    let weid = num(r.fkweid);
    if (weid === null || !entries.has(weid)) {
      const fk = num(r.fkid);
      const date = isoDate(r.actualdate) ?? isoDate(r.scoredate);
      const cand = fk !== null && date ? byWasraDate.get(`${fk}|${date}`) ?? [] : [];
      weid = cand.length === 1 ? cand[0] : weid;
    }
    if (weid === null) { noEntry++; continue; }
    const e = entries.get(weid);
    const detail = num(r.detail);
    let score: number | null;
    let inners: number | null = null;
    if (e?.dist === "90m") {
      const raw = num(r.result) ?? num(r.interscore);
      score = raw === null ? null : Math.floor(raw); // 90m scores are whole numbers
      inners = num(r.inners);
    } else {
      score = num(r.decimalscore) ?? num(r.result);
    }
    if (score === null || detail === null || detail < 1 || detail > 4) { noScore++; continue; }

    const k = `${weid}|${detail}`;
    const prev = best.get(k);
    const row: HistoryRow = {
      weid, detail, score: Math.round(score * 100) / 100, inners,
      class_name: e?.cls ?? null, distance: e?.dist || null,
    };
    if (!prev || row.score > prev.score || (row.score === prev.score && (row.inners ?? 0) > (prev.inners ?? 0))) {
      best.set(k, row);
    }
    if (e?.date) nights.push(e.date);
  }

  nights.sort();
  return {
    rows: [...best.values()],
    scoreRowsRead: scoreRows.length,
    noEntry,
    noScore,
    firstNight: nights[0] ?? null,
    lastNight: nights[nights.length - 1] ?? null,
  };
}
