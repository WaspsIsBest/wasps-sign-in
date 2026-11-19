"use client";
import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import EntryForm, { type MemberInfo } from "@/components/EntryForm";

type MyEntry = {
  id: number; event_date: string; shooting_class: string; position: string;
  distance: string; target_type: string; entries_open: boolean;
};
type Mode = "signin" | "signup" | "forgot";

function prettyDate(iso: string) {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString("en-AU", { weekday: "long", day: "numeric", month: "long" });
}

export default function MemberApp() {
  const supabase = useMemo(() => createClient(), []);
  const [ready, setReady] = useState(false);
  const [signedIn, setSignedIn] = useState(false);
  const [recovery, setRecovery] = useState(false);
  const [member, setMember] = useState<MemberInfo | null | undefined>(undefined);
  const [entries, setEntries] = useState<MyEntry[]>([]);
  const [entryVersion, setEntryVersion] = useState(0);

  const [mode, setMode] = useState<Mode>("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [password2, setPassword2] = useState("");
  const [wasra, setWasra] = useState("");
  const [surname, setSurname] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [info, setInfo] = useState("");

  const loadMember = useCallback(async () => {
    const { data } = await supabase.rpc("member_portal_status");
    if (data?.outcome === "linked") {
      setMember({ wasra_number: data.wasra_number, first_name: data.first_name, surname: data.surname });
    } else {
      setMember(null);
    }
  }, [supabase]);

  const loadEntries = useCallback(async () => {
    const { data } = await supabase.rpc("my_entries");
    if (data?.outcome === "ok") setEntries(data.entries as MyEntry[]);
  }, [supabase]);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSignedIn(Boolean(data.session));
      setReady(true);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === "PASSWORD_RECOVERY") setRecovery(true);
      setSignedIn(Boolean(session));
      if (!session) { setMember(undefined); setEntries([]); }
    });
    return () => sub.subscription.unsubscribe();
  }, [supabase]);

  useEffect(() => {
    if (signedIn && !recovery) void loadMember();
  }, [signedIn, recovery, loadMember]);

  useEffect(() => {
    if (member) void loadEntries();
  }, [member, entryVersion, loadEntries]);

  async function doSignIn(e: FormEvent) {
    e.preventDefault(); setBusy(true); setError(""); setInfo("");
    const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
    setBusy(false);
    if (error) setError(error.message === "Email not confirmed" ? "Please confirm your email first. Check your inbox for the link." : "Email or password is not right.");
  }

  async function doSignUp(e: FormEvent) {
    e.preventDefault(); setError(""); setInfo("");
    if (password.length < 8) { setError("Use a password of at least 8 characters."); return; }
    if (password !== password2) { setError("The two passwords do not match."); return; }
    setBusy(true);
    const { data, error } = await supabase.auth.signUp({
      email: email.trim(), password,
      options: { emailRedirectTo: `${window.location.origin}/member` },
    });
    setBusy(false);
    if (error) { setError(error.message); return; }
    if (!data.session) {
      setInfo("Check your email and click the confirmation link. Then come back here and sign in.");
      setMode("signin"); setPassword(""); setPassword2("");
    }
  }

  async function doForgot(e: FormEvent) {
    e.preventDefault(); setBusy(true); setError(""); setInfo("");
    const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), {
      redirectTo: `${window.location.origin}/member`,
    });
    setBusy(false);
    if (error) { setError(error.message); return; }
    setInfo("If that email has a login, a reset link is on its way.");
  }

  async function doNewPassword(e: FormEvent) {
    e.preventDefault(); setError("");
    if (password.length < 8) { setError("Use a password of at least 8 characters."); return; }
    if (password !== password2) { setError("The two passwords do not match."); return; }
    setBusy(true);
    const { error } = await supabase.auth.updateUser({ password });
    setBusy(false);
    if (error) { setError(error.message); return; }
    setRecovery(false); setPassword(""); setPassword2(""); setInfo("Password changed.");
  }

  async function doLink(e: FormEvent) {
    e.preventDefault(); setBusy(true); setError("");
    const { data, error } = await supabase.rpc("link_member_account", { p_wasra: wasra.trim(), p_surname: surname.trim() });
    setBusy(false);
    if (error) { setError("Could not link. Please try again."); return; }
    if (data?.outcome === "linked") { await loadMember(); return; }
    setError(data?.message ?? "Could not link your membership.");
  }

  async function cancelEntry(id: number) {
    if (!window.confirm("Withdraw this entry?")) return;
    const { data } = await supabase.rpc("cancel_my_entry", { p_entry_id: id });
    if (data?.outcome !== "ok") { setError(data?.message ?? "Could not withdraw."); return; }
    setError("");
    setEntryVersion((v) => v + 1);
  }

  async function signOut() {
    await supabase.auth.signOut();
    setSignedIn(false);
  }

  const header = (
    <header className="topbar">
      <div className="brand">WASPS Member Area</div>
    </header>
  );

  if (!ready) return <div className="shell">{header}<main className="main"><p className="muted">Loading...</p></main></div>;

  if (recovery) {
    return (
      <div className="shell">{header}
        <main className="main">
          <h2>Choose a new password</h2>
          <form onSubmit={doNewPassword}>
            <label className="field"><span>New password</span><input type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} required /></label>
            <label className="field"><span>Repeat password</span><input type="password" autoComplete="new-password" value={password2} onChange={(e) => setPassword2(e.target.value)} required /></label>
            {error && <p className="error-text">{error}</p>}
            <button className="primary full" disabled={busy}>{busy ? "Saving..." : "Save password"}</button>
          </form>
        </main>
      </div>
    );
  }

  if (!signedIn) {
    return (
      <div className="shell">{header}
        <main className="main">
          <h2>{mode === "signin" ? "Sign in" : mode === "signup" ? "Create your login" : "Reset your password"}</h2>
          {info && <div className="result info"><p>{info}</p></div>}
          <form onSubmit={mode === "signin" ? doSignIn : mode === "signup" ? doSignUp : doForgot}>
            <label className="field"><span>Email</span><input type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} required /></label>
            {mode !== "forgot" && (
              <label className="field"><span>Password</span><input type="password" autoComplete={mode === "signup" ? "new-password" : "current-password"} value={password} onChange={(e) => setPassword(e.target.value)} required /></label>
            )}
            {mode === "signup" && (
              <label className="field"><span>Repeat password</span><input type="password" autoComplete="new-password" value={password2} onChange={(e) => setPassword2(e.target.value)} required /></label>
            )}
            {error && <p className="error-text">{error}</p>}
            <button className="primary full" disabled={busy}>
              {busy ? "Please wait..." : mode === "signin" ? "Sign in" : mode === "signup" ? "Create login" : "Send reset link"}
            </button>
          </form>
          <div className="actions" style={{ marginTop: 12 }}>
            {mode !== "signin" && <button className="secondary" type="button" onClick={() => { setMode("signin"); setError(""); setInfo(""); }}>Back to sign in</button>}
            {mode === "signin" && <button className="secondary" type="button" onClick={() => { setMode("signup"); setError(""); setInfo(""); }}>Create a login</button>}
            {mode === "signin" && <button className="secondary" type="button" onClick={() => { setMode("forgot"); setError(""); setInfo(""); }}>Forgot password</button>}
          </div>
        </main>
      </div>
    );
  }

  if (member === undefined) return <div className="shell">{header}<main className="main"><p className="muted">Loading...</p></main></div>;

  if (member === null) {
    return (
      <div className="shell">{header}
        <main className="main">
          <h2>Link your membership</h2>
          <p className="muted">Do this once. Enter your WASRA number and surname exactly as on your membership card.</p>
          <form onSubmit={doLink}>
            <label className="field"><span>WASRA membership number</span><input inputMode="numeric" autoComplete="off" value={wasra} onChange={(e) => setWasra(e.target.value)} required /></label>
            <label className="field"><span>Surname</span><input autoComplete="family-name" value={surname} onChange={(e) => setSurname(e.target.value)} required /></label>
            {error && <p className="error-text">{error}</p>}
            <button className="primary full" disabled={busy}>{busy ? "Checking..." : "Link my membership"}</button>
          </form>
          <div className="actions" style={{ marginTop: 12 }}><button className="secondary" type="button" onClick={signOut}>Sign out</button></div>
        </main>
      </div>
    );
  }

  return (
    <div className="shell">{header}
      <main className="main">
        <h2>Hello {member.first_name}</h2>
        {info && <div className="result info"><p>{info}</p></div>}
        {error && <p className="error-text">{error}</p>}
        {entries.length > 0 && (
          <div className="result success">
            <strong>Your entries</strong>
            {entries.map((x) => (
              <p key={x.id}>
                {prettyDate(x.event_date)}: {x.shooting_class}{x.position && x.position !== "Benchrest" ? `, ${x.position}` : ""}, {x.distance}, {x.target_type}
                {x.entries_open ? (
                  <> <button className="danger" type="button" onClick={() => cancelEntry(x.id)}>Withdraw</button></>
                ) : <span className="muted"> (entries closed)</span>}
              </p>
            ))}
          </div>
        )}
        <h2>Enter an event</h2>
        <EntryForm key={entryVersion} member={member} onEntered={() => void loadEntries()} />
        <div className="actions" style={{ marginTop: 16 }}>
          <Link href="/championship" className="secondary" style={{ padding: "12px 16px", borderRadius: 12, textDecoration: "none", fontWeight: 700 }}>Championship</Link>
          <button className="secondary" type="button" onClick={signOut}>Sign out</button>
        </div>
      </main>
    </div>
  );
}
