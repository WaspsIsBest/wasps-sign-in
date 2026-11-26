"use client";
import { useState } from "react";

// Line chart of a value by month, one line per series, with a hover tooltip,
// legend + end labels, and a table view. Colours follow the class, never the order.

export const CLASS_COLOURS: Record<string, string> = {
  Benchrest: "#338ced",
  "F-Open": "#e76624",
  Modified: "#00a888",
  Sporter: "#d28e05",
};
const OTHER = "#9887ef";
const MUTED = "#8a8a8a";

export type Series = { name: string; points: Record<string, number>; colour?: string; dashed?: boolean };

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
export const monthLabel = (m: string) => `${MONTHS[Number(m.slice(5, 7)) - 1]} ${m.slice(2, 4)}`;

export function colourFor(name: string, dashed?: boolean) {
  if (dashed) return MUTED;
  return CLASS_COLOURS[name] ?? OTHER;
}

export default function MonthlyChart({ series, title, unit = "" }: { series: Series[]; title: string; unit?: string }) {
  const [hover, setHover] = useState<number | null>(null);
  const [asTable, setAsTable] = useState(false);

  const months = [...new Set(series.flatMap((s) => Object.keys(s.points)))].sort();
  const values = series.flatMap((s) => Object.values(s.points));
  if (months.length === 0 || values.length === 0) return <p className="muted">No scores yet for this view.</p>;

  let lo = Math.min(...values);
  let hi = Math.max(...values);
  const pad = Math.max((hi - lo) * 0.12, 0.5);
  lo = Math.floor(lo - pad);
  hi = Math.ceil(hi + pad);

  const W = 680, H = 280, L = 44, R = 92, T = 16, B = 30;
  const x = (i: number) => L + (months.length === 1 ? (W - L - R) / 2 : (i * (W - L - R)) / (months.length - 1));
  const y = (v: number) => T + ((hi - v) * (H - T - B)) / (hi - lo || 1);
  const ticks = Array.from({ length: 5 }, (_, i) => lo + ((hi - lo) * i) / 4);

  return (
    <figure style={{ margin: "12px 0" }}>
      <figcaption style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 8 }}>
        <strong>{title}</strong>
        <button className="secondary" style={{ padding: "4px 10px", fontSize: ".8rem" }} onClick={() => setAsTable(!asTable)}>
          {asTable ? "Chart" : "Table"}
        </button>
      </figcaption>

      <div style={{ display: "flex", flexWrap: "wrap", gap: "4px 14px", margin: "8px 0", fontSize: ".82rem" }}>
        {series.map((s) => (
          <span key={s.name} style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
            <svg width="18" height="8" aria-hidden><line x1="1" y1="4" x2="17" y2="4" stroke={s.colour ?? colourFor(s.name, s.dashed)} strokeWidth="2" strokeDasharray={s.dashed ? "4 3" : undefined} strokeLinecap="round" /></svg>
            {s.name}
          </span>
        ))}
      </div>

      {asTable ? (
        <div style={{ overflowX: "auto" }}>
          <table style={{ borderCollapse: "collapse", fontSize: ".85rem" }}>
            <thead><tr><th style={{ textAlign: "left", padding: "4px 8px" }}>Month</th>{series.map((s) => <th key={s.name} style={{ textAlign: "right", padding: "4px 8px" }}>{s.name}</th>)}</tr></thead>
            <tbody>{months.map((m) => (
              <tr key={m}><td style={{ padding: "4px 8px" }}>{monthLabel(m)}</td>
                {series.map((s) => <td key={s.name} style={{ textAlign: "right", padding: "4px 8px" }}>{s.points[m]?.toFixed(2) ?? "-"}</td>)}</tr>
            ))}</tbody>
          </table>
        </div>
      ) : (
        <div style={{ position: "relative" }}>
          <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label={title} onMouseLeave={() => setHover(null)}>
            {ticks.map((t) => (
              <g key={t}>
                <line x1={L} x2={W - R} y1={y(t)} y2={y(t)} stroke="#2a2a2a" />
                <text x={L - 6} y={y(t) + 4} textAnchor="end" fontSize="11" fill="#a3a3a3">{t.toFixed(hi - lo < 8 ? 1 : 0)}</text>
              </g>
            ))}
            {months.map((m, i) => (
              (months.length <= 12 || i % Math.ceil(months.length / 12) === 0) &&
              <text key={m} x={x(i)} y={H - 10} textAnchor="middle" fontSize="11" fill="#a3a3a3">{monthLabel(m)}</text>
            ))}
            {hover !== null && <line x1={x(hover)} x2={x(hover)} y1={T} y2={H - B} stroke="#5a5a5a" />}
            {series.map((s) => {
              const c = s.colour ?? colourFor(s.name, s.dashed);
              const pts = months.map((m, i) => (s.points[m] !== undefined ? [x(i), y(s.points[m])] : null));
              const segs: string[] = [];
              let cur = "";
              for (const p of pts) {
                if (!p) { if (cur) segs.push(cur); cur = ""; continue; }
                cur += `${cur ? "L" : "M"}${p[0].toFixed(1)},${p[1].toFixed(1)}`;
              }
              if (cur) segs.push(cur);
              const lastIdx = pts.map((p, i) => (p ? i : -1)).filter((i) => i >= 0).pop();
              return (
                <g key={s.name}>
                  {segs.map((d, i) => <path key={i} d={d} fill="none" stroke={c} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" strokeDasharray={s.dashed ? "5 4" : undefined} />)}
                  {pts.map((p, i) => p && <circle key={i} cx={p[0]} cy={p[1]} r={hover === i ? 5 : 3.5} fill={c} stroke="#0a0a0a" strokeWidth="2" />)}
                  {lastIdx !== undefined && series.length <= 5 && (
                    <text x={x(lastIdx) + 8} y={y(s.points[months[lastIdx]]) + 4} fontSize="11" fill="#f5f5f5">{s.name}</text>
                  )}
                </g>
              );
            })}
            {months.map((m, i) => (
              <rect key={m} x={x(i) - (W - L - R) / Math.max(months.length - 1, 1) / 2} y={T} width={(W - L - R) / Math.max(months.length - 1, 1)} height={H - T - B}
                fill="transparent" onMouseEnter={() => setHover(i)} onClick={() => setHover(i)} />
            ))}
          </svg>
          {hover !== null && (
            <div style={{ position: "absolute", top: 8, left: `${Math.min((x(hover) / W) * 100, 62)}%`, background: "#000", border: "1px solid #5a5a5a",
              borderRadius: 8, padding: "6px 10px", fontSize: ".8rem", pointerEvents: "none", whiteSpace: "nowrap" }}>
              <strong>{monthLabel(months[hover])}</strong>
              {series.filter((s) => s.points[months[hover]] !== undefined).map((s) => (
                <div key={s.name}><span style={{ color: s.colour ?? colourFor(s.name, s.dashed) }}>●</span> {s.name}: {s.points[months[hover]].toFixed(2)}{unit}</div>
              ))}
            </div>
          )}
        </div>
      )}
    </figure>
  );
}
