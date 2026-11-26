"use client";
import { ChangeEvent, useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import * as XLSX from "xlsx";
import { createClient } from "@/lib/supabase/client";

type InviteRow = {
  id: number;
  wasra_number: number;
  email: string;
  name: string;
  status: "pending" | "sent" | "joined" | "failed" | "skipped";
  message: string | null;
  sent_at: string | null;
  send_count: number;
};
type FileRow = { wasra: string; email: string };
type Problem = { line: number; wasra: unknown; email: string; problem: string };

const STATUS_LABEL: Record<InviteRow["status"], string> = {
  pending: "Waiting to send",
  sent: "Invite sent",
  joined: "Joined",
  failed: "Failed",
  skipped: "Skipped",
};

function pickColumn(headers: string[], test: (h: string) => boolean) {
  return headers.find((h) => test(h.toLowerCase().replace(/[^a-z]/g, "")));
}

function readFile(buffer: ArrayBuffer): FileRow[] {
  const wb = XLSX.read(buffer, { type: "array" });
  const sheet = wb.Sheets[wb.SheetNames[0]];
  const raw = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: "", raw: false });
  if (raw.length === 0) return [];
  const headers = Object.keys(raw[0]);
  const wasraCol =
    pickColumn(headers, (h) => h.includes("wasra")) ??
    pickColumn(headers, (h) => /^(member|membership)(number|no|num|id)$/.test(h));
  const emailCol = pickColumn(headers, (h) => h.includes("email"));
  if (!wasraCol || !emailCol) {
    throw new Error("Need a WASRA number column and an Email column in the first row.");
  }
  return raw
    .map((r) => ({ wasra: String(r[wasraCol] ?? "").trim(), email: String(r[emailCol] ?? "").trim() }))
    .filter((r) => r.wasra !== "" || r.email !== "");
}

export default function InviteMembersApp() {
  const supabase = useMemo(() => createClient(), []);
  const [allowed, setAllowed] = useState<boolean | null>(null);
  const [invites, setInvites] = useState<InviteRow[]>([]);
  const [fileRows, setFileRows] = useState<FileRow[] | null>(null);
  const [fileName, setFileName] = useState("");
  const [problems, setProblems] = useState<Problem[]>([]);
  const [batchSize, setBatchSize] = useState(20);
  const [filter, setFilter] = useState<"all" | InviteRow["status"]>("all");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [info, setInfo] = useState("");

  const load = useCallback(async () => {
    const { data, error: rpcError } = await supabase.rpc("admin_list_invites");
    if (rpcError) {
      setError(`Could not load invites: ${rpcError.message}. Run 027_member_invites.sql in Supabase first.`);
      return;
    }
    if (data?.outcome === "ok") setInvites(data.invites as InviteRow[]);
    else setError(data?.message ?? "Could not load invites.");
  }, [supabase]);

  useEffect(() => {
    async function init() {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { window.location.href = "/login"; return; }
      const { data } = await supabase.from("user_profiles").select("role,is_active").eq("user_id", user.id).maybeSingle();
      const ok = Boolean(data?.is_active && data.role === "admin");
      setAllowed(ok);
      if (ok) await load();
    }
    void init();
  }, [supabase, load]);

  async function onFile(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    setFileRows(null); setProblems([]); setError(""); setInfo("");
    if (!file) return;
    setFileName(file.name);
    try {
      setFileRows(readFile(await file.arrayBuffer()));
    } catch (err) {
      setError(err instanceof Error ? err.message : "That file could not be read.");
    }
  }

  async function loadList() {
    if (!fileRows || busy) return;
    setBusy(true); setError(""); setInfo("");
    try {
      const { data, error: rpcError } = await supabase.rpc("admin_load_invites", { p_rows: fileRows });
      if (rpcError) { setError(`Load failed: ${rpcError.message}`); return; }
      if (data?.outcome !== "loaded") { setError(data?.message ?? "Load refused."); return; }
      setProblems((data.problems ?? []) as Problem[]);
      setInfo(
        `Added ${data.added} to the queue, updated ${data.updated} email(s), ${data.unchanged} already in the list, ` +
        `${data.already_have_login} already have a login.` +
        ((data.problems?.length ?? 0) > 0 ? ` ${data.problems.length} row(s) not loaded - see below.` : ""),
      );
      setFileRows(null);
      await load();
    } finally {
      setBusy(false);
    }
  }

  async function sendBatch() {
    if (busy) return;
    const waiting = invites.filter((i) => i.status === "pending").length;
    const n = Math.min(batchSize, waiting);
    if (n === 0) return;
    if (!window.confirm(`Send login invites to the next ${n} member(s)?`)) return;
    setBusy(true); setError(""); setInfo("");
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const res = await fetch("/api/admin/send-invites", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${session?.access_token ?? ""}` },
        body: JSON.stringify({ batchSize }),
      });
      const body = await res.json().catch(() => ({}));
      if (body?.outcome !== "ok") { setError(body?.message ?? `Sending failed (${res.status}).`); return; }
      setInfo(
        `Sent ${body.sent}, failed ${body.failed}, skipped ${body.skipped}. ${body.remaining} still waiting.` +
        (body.stoppedEarly ? ` ${body.stoppedEarly}` : ""),
      );
    } finally {
      await load();
      setBusy(false);
    }
  }

  async function requeue(id: number) {
    const { data } = await supabase.rpc("admin_requeue_invite", { p_id: id });
    if (data?.outcome !== "ok") { setError(data?.message ?? "Could not requeue."); return; }
    await load();
  }

  if (allowed === null) return <main className="main">Checking permissions...</main>;
  if (!allowed) {
    return (
      <main className="main">
        <h2>Not authorised</h2>
        <p>Only administrators can invite members.</p>
        <Link href="/sign-in">Return to sign-in</Link>
      </main>
    );
  }

  const counts = invites.reduce<Record<string, number>>((acc, i) => { acc[i.status] = (acc[i.status] ?? 0) + 1; return acc; }, {});
  const shown = filter === "all" ? invites : invites.filter((i) => i.status === filter);
  const th = { textAlign: "left" as const, padding: "6px 8px", borderBottom: "1px solid #444" };
  const td = { padding: "6px 8px", borderBottom: "1px solid #2a2a2a", verticalAlign: "top" as const };

  return (
    <main className="main">
      <h1>Invite members</h1>
      <p className="muted">
        Each member gets an email with a link to set a password. Their login is linked to their
        membership automatically and can only enter events and see the championship - never staff screens.
      </p>

      <section className="result info">
        <strong>1. Load the member list</strong>
        <p className="muted">CSV or Excel with a WASRA number column and an Email column. Loading again only adds new people.</p>
        <label className="field">
          <span>Member list</span>
          <input type="file" accept=".csv,.xlsx,.xls" onChange={onFile} />
        </label>
        {fileRows && (
          <div className="actions">
            <span>{fileName}: {fileRows.length} rows read.</span>
            <button className="primary" type="button" onClick={loadList} disabled={busy}>Add to invite list</button>
          </div>
        )}
      </section>

      <section className="result info" style={{ marginTop: 12 }}>
        <strong>2. Send in batches</strong>
        <p>
          Waiting {counts.pending ?? 0} · Sent {counts.sent ?? 0} · Joined {counts.joined ?? 0} ·
          Failed {counts.failed ?? 0} · Skipped {counts.skipped ?? 0}
        </p>
        <div className="actions">
          <label className="field" style={{ maxWidth: 160 }}>
            <span>Batch size</span>
            <input type="number" min={1} max={50} value={batchSize}
              onChange={(e) => setBatchSize(Math.min(50, Math.max(1, Number(e.target.value) || 1)))} />
          </label>
          <button className="primary" type="button" onClick={sendBatch} disabled={busy || !(counts.pending > 0)}>
            {busy ? "Working..." : "Send next batch"}
          </button>
        </div>
        <p className="muted">Keep each batch within your hourly email limit (Supabase: Authentication &gt; Rate Limits).</p>
      </section>

      {error && <p className="error-text">{error}</p>}
      {info && <div className="result success"><p>{info}</p></div>}

      {problems.length > 0 && (
        <section className="result error" style={{ marginTop: 12 }}>
          <strong>Rows not loaded</strong>
          {problems.map((p) => (
            <p key={p.line}>Row {p.line}: {String(p.wasra ?? "")} {p.email} - {p.problem}</p>
          ))}
        </section>
      )}

      <div className="actions" style={{ marginTop: 16 }}>
        {(["all", "pending", "sent", "joined", "failed", "skipped"] as const).map((f) => (
          <button key={f} type="button" className={filter === f ? "primary" : "secondary"} onClick={() => setFilter(f)}>
            {f === "all" ? `All (${invites.length})` : `${STATUS_LABEL[f]} (${counts[f] ?? 0})`}
          </button>
        ))}
      </div>

      <div style={{ overflowX: "auto", marginTop: 8 }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 14 }}>
          <thead>
            <tr><th style={th}>Name</th><th style={th}>WASRA</th><th style={th}>Email</th><th style={th}>Status</th><th style={th}></th></tr>
          </thead>
          <tbody>
            {shown.map((i) => (
              <tr key={i.id}>
                <td style={td}>{i.name}</td>
                <td style={td}>{i.wasra_number}</td>
                <td style={td}>{i.email}</td>
                <td style={td}>
                  {STATUS_LABEL[i.status]}
                  {i.sent_at && i.status !== "pending" && <span className="muted"> {new Date(i.sent_at).toLocaleDateString("en-AU")}</span>}
                  {i.send_count > 1 && <span className="muted"> (sent {i.send_count}x)</span>}
                  {i.message && <div className="muted">{i.message}</div>}
                </td>
                <td style={td}>
                  {(i.status === "sent" || i.status === "failed") && (
                    <button className="secondary" type="button" onClick={() => requeue(i.id)}>
                      {i.status === "sent" ? "Resend" : "Retry"}
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </main>
  );
}
