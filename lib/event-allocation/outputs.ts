import { MATCH_CODE_D1, MATCH_CODE_OTHER, START_LIST_CLUB } from "./rules";
import type { AllocationResult, Shooter } from "./types";

const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];
const DAY_NAMES = [
  "Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday",
];

// "2026-07-05" -> "Sunday 05 July 2026"
export function longDate(iso: string) {
  const [y, m, d] = iso.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return `${DAY_NAMES[dt.getUTCDay()]} ${String(d).padStart(2, "0")} ${MONTH_NAMES[m - 1]} ${y}`;
}

// "2026-07-05" -> "260705"
export function eventPrefix(iso: string) {
  const [y, m, d] = iso.split("-");
  return `${y.slice(2)}${m}${d}`;
}

// ------------------------------------------------------------- start lists

export type StartList = {
  filename: string;
  content: string;
  count: number;
};

// One file per detail for the scoring system import. Electronic shooters
// only; paper results are handled separately.
export function buildStartList(
  result: AllocationResult,
  detailIndex: 0 | 1 | 2 | 3,
): StartList {
  const prefix = eventPrefix(result.eventDate);
  const detailNo = detailIndex + 1;
  const matchCode = detailIndex === 0 ? MATCH_CODE_D1 : MATCH_CODE_OTHER;
  const eventCode = `${prefix}WD${detailNo}`;

  const rows = result.shooters
    .filter(
      (s) =>
        !s.isPaper && s.d[detailIndex] !== null && s.wasra !== null,
    )
    .sort(
      (a, b) =>
        (a.d[detailIndex] as number) - (b.d[detailIndex] as number) ||
        (a.competitor < b.competitor ? -1 : a.competitor > b.competitor ? 1 : 0),
    );

  const lines = rows.map(
    (s) =>
      `${s.weid},"${s.competitor}",${s.wasra},"0","0",` +
      `"${START_LIST_CLUB}","6",${s.d[detailIndex]},"","",` +
      `"AUS","-c",${s.mcid},"-m","${matchCode}","${eventCode}"`,
  );

  return {
    filename: `${prefix}_D${detailNo}.txt`,
    // CRLF line endings, as the scoring import has always received them.
    content: lines.length ? lines.join("\r\n") + "\r\n" : "",
    count: rows.length,
  };
}

export function electronicShootersMissingABay(
  result: AllocationResult,
): string[] {
  const names = new Set<string>();
  for (const s of result.shooters) {
    if (s.isPaper) continue;
    if (s.d.some((b) => b === null)) names.add(s.competitor);
  }
  return [...names].sort();
}

export function downloadTextFile(filename: string, content: string) {
  const blob = new Blob([content], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

// ------------------------------------------------------------- PDF report

const cell = (n: number | null) => (n === null ? "" : String(n));

export async function downloadReportPdf(result: AllocationResult) {
  const { jsPDF } = await import("jspdf");
  const autoTable = (await import("jspdf-autotable")).default;

  const doc = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4" });
  const margin = 10;
  const headFill: [number, number, number] = [44, 62, 80];
  const altFill: [number, number, number] = [242, 242, 242];

  doc.setFont("helvetica", "bold");
  doc.setFontSize(18);
  doc.text(`Bay Assignments - ${longDate(result.eventDate)}`, margin, 16);

  const total = result.shooters.length;
  const nElectronic = result.shooters.filter((s) => s.isElectronic).length;
  const nPaper = result.shooters.filter((s) => s.isPaper).length;
  const nUnassigned = result.shooters.filter((s) => s.d[0] === null).length;
  const summary = [
    `${total} shooters`,
    `${nElectronic} electronic`,
    `${nPaper} paper`,
  ];
  if (nUnassigned) summary.push(`${nUnassigned} without a detail 1 bay`);

  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);
  doc.text(summary.join(" | "), margin, 23);

  const sortedShooters: Shooter[] = [...result.shooters].sort((a, b) =>
    a.competitor < b.competitor ? -1 : a.competitor > b.competitor ? 1 : 0,
  );

  const common = {
    margin: { left: margin, right: margin, top: margin, bottom: margin },
    theme: "grid" as const,
    headStyles: {
      fillColor: headFill,
      textColor: 255,
      fontStyle: "bold" as const,
      halign: "center" as const,
    },
    alternateRowStyles: { fillColor: altFill },
    styles: { halign: "center" as const, valign: "middle" as const, lineColor: [150, 150, 150] as [number, number, number], lineWidth: 0.1 },
  };

  autoTable(doc, {
    ...common,
    startY: 27,
    head: [["WEID", "Competitor", "WASRA", "TT", "Dist", "Class", "Pos", "D1", "D2", "D3", "D4"]],
    body: sortedShooters.map((s) => [
      String(s.weid),
      s.competitor,
      s.wasra === null ? "" : String(s.wasra),
      s.targetCode,
      s.distance.slice(0, 3),
      s.shootingClass.slice(0, 18),
      s.position.slice(0, 6),
      cell(s.d[0]),
      cell(s.d[1]),
      cell(s.d[2]),
      cell(s.d[3]),
    ]),
    styles: { ...common.styles, fontSize: 10, cellPadding: 1.4 },
    headStyles: { ...common.headStyles, fontSize: 11 },
  });

  const afterBays = (doc as unknown as { lastAutoTable: { finalY: number } })
    .lastAutoTable.finalY;

  doc.setFont("helvetica", "bold");
  doc.setFontSize(14);
  doc.text("Volunteer Assignments", margin, afterBays + 10);

  autoTable(doc, {
    ...common,
    startY: afterBays + 13,
    head: [["Role", "D1", "D2", "D3", "D4"]],
    body: result.volunteers.map((v) => [v.role, ...v.d]),
    styles: { ...common.styles, fontSize: 11, cellPadding: 1.8 },
    headStyles: { ...common.headStyles, fontSize: 12 },
  });

  const afterVols = (doc as unknown as { lastAutoTable: { finalY: number } })
    .lastAutoTable.finalY;

  doc.setFont("helvetica", "bold");
  doc.setFontSize(14);
  doc.text("Available Bays", margin, afterVols + 10);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);
  doc.text(
    `${result.availableBays.length} bay(s) free for all four details`,
    margin,
    afterVols + 15,
  );

  const perRow = 10;
  const free = result.availableBays.map(String);
  const body: string[][] = [];
  for (let i = 0; i < free.length; i += perRow) {
    const chunk = free.slice(i, i + perRow);
    while (chunk.length < perRow) chunk.push("");
    body.push(chunk);
  }
  if (!body.length) body.push(["None", ...Array(perRow - 1).fill("")]);

  autoTable(doc, {
    ...common,
    startY: afterVols + 18,
    tableWidth: perRow * 14,
    head: [[{ content: "Available Bays", colSpan: perRow }]],
    body,
    styles: { ...common.styles, fontSize: 11, cellPadding: 1.8 },
    headStyles: { ...common.headStyles, fontSize: 12 },
  });

  doc.save(`BayVolunteerReport_${eventPrefix(result.eventDate)}.pdf`);
}
