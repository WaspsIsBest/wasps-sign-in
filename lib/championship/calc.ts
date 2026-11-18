import * as XLSX from "xlsx";

// Turns the Access WeeklyEntryT and ScoreT exports into one row per counted
// score (member, class, distance, night, detail), following the 2026
// supplementary regulations.

export type ScoreRow = {
  wasra: number;
  name: string;
  class_name: string;
  distance: "50m" | "90m";
  night: string; // YYYY-MM-DD
  detail: number;
  score: number;
  inners: number | null;
  scid: number | null;
  weid: number;
};

export type Skipped = {
  scid: number | null;
  date: string | null;
  detail: number | null;
  wasra: number | null;
  weid: number | null;
  score: number | null;
  reason: string;
};

export type CalcResult = {
  rows: ScoreRow[];
  skipped: Skipped[];
  notCounted: Record<string, number>;
  unplaced: Skipped[];
  lastNight: string | null;
  scoreRowsRead: number;
};

// Access class numbers (WeeklyEntryT.FKCID).
const CLASS_BY_FKCID: Record<number, string> = {
  1: "Sporter",
  2: "Modified",
  3: "F-Open",
  14: "Benchrest",
  7: "Sporter",
  8: "Modified",
  9: "F-Open",
  15: "Benchrest",
};

type Entry = {
  id: number;
  wasra: number;
  date: string;
  dist: string;
  tt: string;
  cs: string;
  cls: string | null;
  fkcid: number | null;
  name: string;
};

function key(h: string) {
  return h.replace(/[^A-Za-z0-9]/g, "").toLowerCase();
}

function num(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function isoDate(v: unknown): string | null {
  if (v === null || v === undefined || v === "") return null;
  if (typeof v === "number") {
    return new Date(Date.UTC(1899, 11, 30) + Math.round(v) * 86400000)
      .toISOString()
      .slice(0, 10);
  }
  const s = String(v).trim();
  const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  const dmy = /^(\d{1,2})\/(\d{1,2})\/(\d{4})/.exec(s);
  if (dmy) return `${dmy[3]}-${dmy[2].padStart(2, "0")}-${dmy[1].padStart(2, "0")}`;
  return null;
}

function dayDiff(a: string, b: string) {
  return Math.abs(Date.parse(a) - Date.parse(b)) / 86400000;
}

function tidy(n: string) {
  let s = n.trim();
  if (s.includes(",")) {
    const i = s.indexOf(",");
    s = `${s.slice(i + 1).trim()} ${s.slice(0, i).trim()}`.trim();
  }
  if (s === s.toUpperCase()) {
    s = s.toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());
  }
  return s;
}

function sheetRows(buffer: ArrayBuffer): Record<string, unknown>[] {
  const wb = XLSX.read(buffer, { type: "array" });
  const raw = XLSX.utils.sheet_to_json<Record<string, unknown>>(
    wb.Sheets[wb.SheetNames[0]],
    { defval: null },
  );
  return raw.map((r) => {
    const o: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(r)) o[key(k)] = v;
    return o;
  });
}

export function calculate(
  weeklyBuffer: ArrayBuffer,
  scoreBuffer: ArrayBuffer,
  start = "2026-02-01",
  end = "2026-11-30",
): CalcResult {
  const entries = new Map<number, Entry>();
  for (const r of sheetRows(weeklyBuffer)) {
    const id = num(r.weeklyentryid);
    const date = isoDate(r.eventdate);
    const wasra = num(r.fkmemid);
    if (id === null || !date || !wasra) continue;
    const fkcid = num(r.fkcid);
    entries.set(id, {
      id,
      wasra,
      date,
      dist: String(r.distance ?? "unknown").trim().toLowerCase() || "unknown",
      tt: String(r.targettype ?? "").trim().toUpperCase(),
      cs: String(r.cscore ?? "").trim().toUpperCase(),
      cls: fkcid !== null ? CLASS_BY_FKCID[fkcid] ?? null : null,
      fkcid,
      name: tidy(String(r.cname ?? "")),
    });
  }

  const byWasraDate = new Map<string, number[]>();
  const byWasra = new Map<number, Entry[]>();
  for (const e of entries.values()) {
    const k = `${e.wasra}|${e.date}`;
    byWasraDate.set(k, [...(byWasraDate.get(k) ?? []), e.id]);
    byWasra.set(e.wasra, [...(byWasra.get(e.wasra) ?? []), e]);
  }

  type Resolved = {
    scid: number | null;
    entry: Entry;
    detail: number;
    res: number | null;
    inn: number | null;
    inter: number | null;
    dec: number | null;
  };

  const resolved: Resolved[] = [];
  const unplaced: Skipped[] = [];
  const scoreRows = sheetRows(scoreBuffer);

  for (const r of scoreRows) {
    const scid = num(r.scid);
    const detail = num(r.detail);
    const fk = num(r.fkid);
    const weid = num(r.fkweid);
    const date = isoDate(r.actualdate) ?? isoDate(r.scoredate);
    const dec = num(r.decimalscore);
    const res = num(r.result);
    let entry: Entry | null = null;

    const linked = weid !== null ? entries.get(weid) ?? null : null;
    if (linked && (fk === null || linked.wasra === fk)) {
      entry = linked;
    } else if (fk !== null && date) {
      const exact = byWasraDate.get(`${fk}|${date}`) ?? [];
      if (exact.length >= 1) entry = entries.get(exact[0]) ?? null;
      else {
        const near = (byWasra.get(fk) ?? []).filter((e) => dayDiff(e.date, date) <= 1);
        if (near.length === 1) entry = near[0];
      }
    }

    if (!entry || detail === null) {
      unplaced.push({
        scid,
        date,
        detail,
        wasra: fk,
        weid,
        score: dec ?? res,
        reason: "No matching entry",
      });
      continue;
    }
    resolved.push({
      scid,
      entry,
      detail,
      res,
      inn: num(r.inners),
      inter: num(r.interscore),
      dec,
    });
  }

  // One value per member, night and detail (the highest, as the Access query does).
  const groups = new Map<string, Resolved[]>();
  for (const r of resolved) {
    const k = `${r.entry.wasra}|${r.entry.date}|${r.detail}`;
    groups.set(k, [...(groups.get(k) ?? []), r]);
  }

  type Best = {
    entry: Entry;
    detail: number;
    dist: string;
    score: number;
    inners: number | null;
    scid: number | null;
  };
  const best: Best[] = [];
  for (const g of groups.values()) {
    const first = g[0];
    if (first.entry.dist === "90m") {
      const cand = g
        .filter((x) => x.res !== null || x.inter !== null)
        .map((x) => ({
          x,
          // 90m results are whole numbers; one row was typed as 196.02.
          sc: Math.floor(x.res ?? x.inter ?? 0),
          inn: x.inn ?? 0,
        }));
      if (!cand.length) continue;
      cand.sort((a, b) => a.sc - b.sc || a.inn - b.inn);
      const b = cand[cand.length - 1];
      best.push({
        entry: b.x.entry,
        detail: b.x.detail,
        dist: "90m",
        score: b.sc,
        inners: b.inn,
        scid: b.x.scid,
      });
    } else {
      const cand = g.filter((x) => x.dec !== null);
      if (!cand.length) continue;
      cand.sort((a, b) => (a.dec as number) - (b.dec as number));
      const b = cand[cand.length - 1];
      best.push({
        entry: b.entry,
        detail: b.detail,
        dist: first.entry.dist,
        score: b.dec as number,
        inners: null,
        scid: b.scid,
      });
    }
  }

  const rows: ScoreRow[] = [];
  const notCounted: Record<string, number> = {};
  const why = (m: string) => {
    notCounted[m] = (notCounted[m] ?? 0) + 1;
  };
  for (const b of best) {
    const e = b.entry;
    if (e.date < start || e.date > end) { why("Outside the championship dates"); continue; }
    if (e.cs !== "Y") { why("Not a competitive (CScore) entry"); continue; }
    if (!e.cls) { why(`Class number ${e.fkcid ?? "blank"} not recognised`); continue; }
    if (b.dist === "50m" && e.tt !== "E") { why("50m paper score (electronic only)"); continue; }
    if (b.dist !== "50m" && b.dist !== "90m") { why("Not a 50m or 90m score"); continue; }
    rows.push({
      wasra: e.wasra,
      name: e.name,
      class_name: e.cls,
      distance: b.dist as "50m" | "90m",
      night: e.date,
      detail: b.detail,
      score: Math.round(b.score * 100) / 100,
      inners: b.inners,
      scid: b.scid,
      weid: e.id,
    });
  }

  const lastNight = rows.reduce<string | null>(
    (m, r) => (m === null || r.night > m ? r.night : m),
    null,
  );
  return {
    rows,
    skipped: unplaced,
    notCounted,
    unplaced,
    lastNight,
    scoreRowsRead: scoreRows.length,
  };
}
