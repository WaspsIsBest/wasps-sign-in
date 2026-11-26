// Sends the next batch of member login invites.
// Runs on the server only. Needs SUPABASE_SECRET_KEY (or SUPABASE_SERVICE_ROLE_KEY)
// set in Vercel. Never give that key a NEXT_PUBLIC_ name.
// Only an active admin (user_profiles) can call it. Invited logins get a
// member_accounts link only - never a user_profiles row - so they are not staff.
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_BATCH = 50;

type Invite = {
  id: number;
  wasra_number: number;
  member_id: number | null;
  email: string;
  user_id: string | null;
  send_count: number;
};

function reply(status: number, body: Record<string, unknown>) {
  return Response.json(body, { status });
}

export async function POST(req: Request) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const secret = process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !secret) {
    return reply(500, {
      outcome: "not_configured",
      message: "SUPABASE_SECRET_KEY is not set in Vercel. Add it and redeploy.",
    });
  }
  const admin = createClient(url, secret, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  // Who is calling? Must be an active admin.
  const token = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (!token) return reply(401, { outcome: "not_signed_in", message: "Please sign in again." });
  const { data: who, error: whoError } = await admin.auth.getUser(token);
  if (whoError || !who.user) return reply(401, { outcome: "not_signed_in", message: "Please sign in again." });
  const { data: profile } = await admin
    .from("user_profiles")
    .select("role,is_active")
    .eq("user_id", who.user.id)
    .maybeSingle();
  if (!profile?.is_active || profile.role !== "admin") {
    return reply(403, { outcome: "not_authorised", message: "Only an administrator can send invites." });
  }

  let batchSize = 20;
  try {
    const body = await req.json();
    batchSize = Math.trunc(Number(body?.batchSize) || 20);
  } catch {
    // keep default
  }
  batchSize = Math.min(Math.max(batchSize, 1), MAX_BATCH);

  const { data: queue, error: queueError } = await admin
    .from("member_invites")
    .select("id,wasra_number,member_id,email,user_id,send_count")
    .eq("status", "pending")
    .order("id")
    .limit(batchSize);
  if (queueError) {
    return reply(500, {
      outcome: "error",
      message: `Could not read the invite list: ${queueError.message}. Run 027_member_invites.sql first.`,
    });
  }

  // Where the email link lands. The Invite email template uses {{ .SiteURL }}/member.
  const origin = new URL(req.url).origin;
  let sent = 0;
  let failed = 0;
  let skipped = 0;
  let stoppedEarly = "";

  for (const inv of (queue ?? []) as Invite[]) {
    // Already linked to a different login? Then they don't need an invite.
    const { data: linked } = await admin
      .from("member_accounts")
      .select("user_id")
      .eq("wasra_number", inv.wasra_number)
      .maybeSingle();
    if (linked && linked.user_id !== inv.user_id) {
      await admin.from("member_invites")
        .update({ status: "skipped", message: "Already has a member login" })
        .eq("id", inv.id);
      skipped++;
      continue;
    }

    const { data, error } = await admin.auth.admin.inviteUserByEmail(inv.email, {
      redirectTo: `${origin}/member`,
    });

    if (error) {
      const msg = error.message ?? "Unknown error";
      if (error.status === 429 || /rate limit/i.test(msg)) {
        stoppedEarly =
          "Supabase's email limit was reached, so the rest stay queued. Wait a while and send again, or raise the limit in Authentication > Rate Limits.";
        break;
      }
      const friendly = /already been registered|already registered|email_exists/i.test(msg)
        ? "This email already has a login. They can sign in at /member and link their membership (or use Forgot password)."
        : msg;
      await admin.from("member_invites")
        .update({ status: "failed", message: friendly })
        .eq("id", inv.id);
      failed++;
      continue;
    }

    const userId = data.user?.id ?? null;
    let note: string | null = null;
    if (userId) {
      const { error: linkError } = await admin.from("member_accounts").upsert(
        { user_id: userId, wasra_number: inv.wasra_number, member_id: inv.member_id },
        { onConflict: "user_id", ignoreDuplicates: true },
      );
      if (linkError) note = `Invite sent, but the membership link failed (${linkError.message}). They can link it themselves.`;
    }
    await admin.from("member_invites")
      .update({
        status: "sent",
        message: note,
        user_id: userId,
        sent_at: new Date().toISOString(),
        send_count: inv.send_count + 1,
      })
      .eq("id", inv.id);
    sent++;
  }

  const { count: remaining } = await admin
    .from("member_invites")
    .select("id", { count: "exact", head: true })
    .eq("status", "pending");

  return reply(200, { outcome: "ok", sent, failed, skipped, remaining: remaining ?? 0, stoppedEarly });
}
