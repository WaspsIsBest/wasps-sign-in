"use client";
import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
export default function Login(){
 const [email,setEmail]=useState(""); const [password,setPassword]=useState(""); const [error,setError]=useState(""); const [busy,setBusy]=useState(false); const router=useRouter();
 async function submit(e:FormEvent){e.preventDefault();setBusy(true);setError("");const {error}=await createClient().auth.signInWithPassword({email,password});setBusy(false);if(error){setError(error.message);return}router.replace("/sign-in");router.refresh()}
 return <main className="login-wrap"><form className="login-card" onSubmit={submit}><div className="brand" style={{color:"#102a43"}}>WASPS Weekly Sign-In</div><p className="muted">Staff login</p><label className="field"><span>Email</span><input type="email" value={email} onChange={e=>setEmail(e.target.value)} required autoComplete="email"/></label><label className="field"><span>Password</span><input type="password" value={password} onChange={e=>setPassword(e.target.value)} required autoComplete="current-password"/></label>{error&&<p className="error-text">{error}</p>}<button className="primary full" disabled={busy}>{busy?"Signing in...":"Sign in"}</button></form></main>;
}
