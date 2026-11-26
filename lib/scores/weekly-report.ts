// Weekly results: grouping, ranking and the printable PDF (same layout as the
// Access "Weekly Scores" report). No awards - place is by best score in class.

export type ResultRow = {
  weekly_entry_id: number;
  wasra: number | null;
  name: string;
  distance: string;
  class_name: string;
  target_type: string;
  championship?: boolean;
  details: Record<string, { score: number; inners: number | null }>;
  ordered?: number[];
  best: number;
};

export type RankedRow = ResultRow & { place: number; tied: boolean };
export type Group = { title: string; rows: RankedRow[] };

// Order of classes on the report (others follow alphabetically).
const CLASS_ORDER = ["Modified", "F-Open", "Benchrest", "Sporter"];
const DIST_ORDER = ["50m", "90m"];

export function groupTitle(r: ResultRow) {
  const cls = r.class_name === "F-Open" ? "F Open" : r.class_name;
  return `${cls} ${r.distance.toUpperCase()}${r.target_type === "P" && r.distance === "50m" ? " Paper" : ""}`;
}

// Best score first; a tie on best goes to the better next score, and so on.
function compare(a: ResultRow, b: ResultRow) {
  const sa = (a.ordered ?? [a.best]).map(Number);
  const sb = (b.ordered ?? [b.best]).map(Number);
  for (let i = 0; i < Math.max(sa.length, sb.length); i++) {
    const d = (sb[i] ?? -1) - (sa[i] ?? -1);
    if (d !== 0) return d;
  }
  return 0;
}

export function rankResults(rows: ResultRow[]): Group[] {
  const map = new Map<string, ResultRow[]>();
  for (const r of rows) map.set(groupTitle(r), [...(map.get(groupTitle(r)) ?? []), r]);
  const key = (r: ResultRow) => [
    DIST_ORDER.indexOf(r.distance) < 0 ? 9 : DIST_ORDER.indexOf(r.distance),
    r.target_type === "P" ? 1 : 0,
    CLASS_ORDER.indexOf(r.class_name) < 0 ? 9 : CLASS_ORDER.indexOf(r.class_name),
  ];
  return [...map.values()]
    .sort((a, b) => {
      const ka = key(a[0]), kb = key(b[0]);
      return ka[0] - kb[0] || ka[1] - kb[1] || ka[2] - kb[2] || a[0].class_name.localeCompare(b[0].class_name);
    })
    .map((list) => {
      const sorted = [...list].sort((a, b) => compare(a, b) || a.name.localeCompare(b.name));
      const ranked: RankedRow[] = [];
      sorted.forEach((r, i) => {
        const sameAsPrev = i > 0 && compare(sorted[i - 1], r) === 0;
        const place = sameAsPrev ? ranked[i - 1].place : i + 1;
        if (sameAsPrev) ranked[i - 1].tied = true;
        ranked.push({ ...r, place, tied: sameAsPrev });
      });
      return { title: groupTitle(list[0]), rows: ranked };
    });
}

// "Bruce Lee" -> "Bruce Le" (as on the printed report).
export function shortName(full: string) {
  const parts = full.trim().split(/\s+/);
  if (parts.length < 2) return full.trim();
  return `${parts.slice(0, -1).join(" ")} ${parts[parts.length - 1].slice(0, 2)}`;
}

const fmt = (n: number) => String(Number(Number(n).toFixed(2)));
const scoreText = (s?: { score: number; inners: number | null }) =>
  s ? `${fmt(s.score)}${s.inners != null ? ` (${s.inners})` : ""}` : "0";

async function imageData(url: string): Promise<string | null> {
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const blob = await res.blob();
    return await new Promise((resolve) => {
      const r = new FileReader();
      r.onload = () => resolve(String(r.result));
      r.onerror = () => resolve(null);
      r.readAsDataURL(blob);
    });
  } catch {
    return null;
  }
}

function dmy(iso: string) {
  const [y, m, d] = iso.split("-");
  return `${d}/${m}/${y}`;
}
function longDay(iso: string) {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString("en-AU", { weekday: "long", day: "numeric", month: "long", year: "numeric" });
}

export async function buildWeeklyResultsPdf(eventDate: string, rows: ResultRow[]) {
  const { jsPDF } = await import("jspdf");
  const doc = new jsPDF({ unit: "mm", format: "a4" });
  const [wasps, sponsor] = await Promise.all([imageData("/report/wasps-logo.jpg"), imageData("/report/sponsor-logo.jpg")]);
  const groups = rankResults(rows);

  const W = 210, M = 12;
  const col = { place: 18, name: 32, d: [92, 111, 130, 149], champ: 176, score: 194 };
  const bottom = 255;

  function header() {
    if (wasps) doc.addImage(wasps, "JPEG", M, 10, 52, 28);
    if (sponsor) doc.addImage(sponsor, "JPEG", W - M - 37, 9, 37, 37);
    doc.setFont("helvetica", "bold").setFontSize(18).setTextColor(0);
    doc.text("Weekly Results", W / 2 - 6, 22, { align: "center" });
    doc.setFont("helvetica", "normal").setFontSize(9.5).text("Event Date", M + 3, 45);
    doc.setFont("helvetica", "bold").text(dmy(eventDate), M + 31, 45.5);
    doc.setFontSize(12).text("Place", col.place, 56, { align: "center" });
    doc.text("Competitor", col.name, 56);
    doc.setFont("helvetica", "normal").setFontSize(9.5);
    col.d.forEach((x, i) => doc.text(String(i + 1), x, 54, { align: "center" }));
    doc.setFont("helvetica", "bold").setFontSize(8.5);
    doc.text("Championship", col.champ, 53.5, { align: "center" });
    doc.text("Score", col.champ, 57, { align: "center" });
    doc.setFontSize(12).text("Score", col.score, 56, { align: "center" });
    return 64;
  }

  function footer(page: number, pages: number) {
    doc.setFont("helvetica", "bold").setFontSize(8.5).setTextColor(0);
    doc.text(
      [
        'Note for F-Class competition scores only count if they are recorded from prone position',
        'or have lodged a Medical Exemption - Those with an "Y" are accepted as scores in',
        'overall championship and those with "N" are not.',
      ],
      W / 2, 262, { align: "center", lineHeightFactor: 1.3 },
    );
    doc.text("All Results Are Provisional", W / 2, 279, { align: "center" });
    doc.setFont("helvetica", "normal").setFontSize(9);
    doc.text(longDay(eventDate), M, 289);
    doc.text(`Page ${page} of ${pages}`, W - M, 289, { align: "right" });
  }

  let y = header();
  if (groups.length === 0) {
    doc.setFont("helvetica", "normal").setFontSize(11).text("No scores have been entered for this night.", W / 2, y + 10, { align: "center" });
  }
  for (const g of groups) {
    // Keep a heading with at least two of its rows.
    if (y + 14 + Math.min(g.rows.length, 2) * 7 > bottom) { doc.addPage(); y = header(); }
    doc.setFont("helvetica", "normal").setFontSize(13).setTextColor(60);
    doc.text(g.title, W / 2, y, { align: "center" });
    doc.setDrawColor(0).setLineWidth(0.3).line(M, y + 3.5, W - M, y + 3.5);
    y += 11;
    for (const r of g.rows) {
      if (y > bottom - 4) { doc.addPage(); y = header(); }
      doc.setTextColor(0).setFont("helvetica", "bold").setFontSize(12);
      doc.text(`${r.tied ? "=" : ""}${r.place}`, col.place, y + 0.6, { align: "center" });
      doc.setFont("helvetica", "normal").setFontSize(9.5).setTextColor(70);
      doc.text(shortName(r.name), col.name, y);
      col.d.forEach((x, i) => doc.text(scoreText(r.details[String(i + 1)]), x, y, { align: "center" }));
      doc.setTextColor(0).setFont("helvetica", "bold").setFontSize(9.5);
      doc.text(r.championship === false ? "N" : "Y", col.champ, y - 0.6, { align: "center" });
      doc.setFontSize(12.5).text(fmt(r.best), col.score, y + 0.8, { align: "center" });
      y += 7;
    }
    y += 2;
  }

  const pages = doc.getNumberOfPages();
  for (let p = 1; p <= pages; p++) { doc.setPage(p); footer(p, pages); }
  return doc;
}

export async function weeklyResultsPdf(eventDate: string, rows: ResultRow[]) {
  const doc = await buildWeeklyResultsPdf(eventDate, rows);
  const [yy, mm, dd] = eventDate.split("-");
  doc.save(`${dd}${mm}${yy}_Weekly_Scores.pdf`);
}
