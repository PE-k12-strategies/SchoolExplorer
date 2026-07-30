import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.8";

const ADMIN_EMAIL = "k12strategies@perkinseastman.com";
const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY");
const NOTIFY_SECRET = Deno.env.get("NOTIFY_SECRET");
const FROM_EMAIL = Deno.env.get("FROM_EMAIL") ?? "PE Dashboards <onboarding@resend.dev>";
const APP_BASE =
  (Deno.env.get("APP_BASE_URL") ?? Deno.env.get("INDEX_PAGE_URL") ??
    "https://pe-k12-strategies.github.io/SchoolExplorer").replace(/\/$/, "");
const INDEX_PAGE_URL = Deno.env.get("INDEX_PAGE_URL") || `${APP_BASE}/index.html`;
const DASHBOARD_URL = Deno.env.get("DASHBOARD_URL") || `${APP_BASE}/nces.html`;
const NOTIFY_EMAIL = Deno.env.get("NOTIFY_EMAIL") ?? "d.wieberdink@perkinseastman.com";

interface ChangeRow {
  field?: string;
  old_value?: string;
  new_value?: string;
}

interface UserUpdatePayload {
  name?: string;
  email?: string;
  updated_by?: string;
  changes?: ChangeRow[];
}

function escapeHtml(value: string): string {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

async function isAuthorized(req: Request): Promise<boolean> {
  const secret = req.headers.get("x-notify-secret");
  if (NOTIFY_SECRET && secret === NOTIFY_SECRET) return true;

  const authHeader = req.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) return false;

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_ANON_KEY") ?? "",
    { global: { headers: { Authorization: authHeader } } },
  );

  const { data: { user }, error } = await supabase.auth.getUser();
  if (error || !user) return false;
  return user.email === ADMIN_EMAIL;
}

async function sendEmail(to: string, subject: string, html: string) {
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${RESEND_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ from: FROM_EMAIL, to: [to], subject, html }),
  });

  if (!res.ok) {
    return { ok: false as const, error: await res.text() };
  }

  const data = await res.json();
  return { ok: true as const, id: data.id };
}

function isApproved(changes: ChangeRow[]): boolean {
  return changes.some(
    (c) =>
      String(c.field || "").toLowerCase().includes("access") &&
      String(c.new_value || "").toLowerCase() === "approved",
  );
}

function linksBlock(): string {
  return `
    <p style="margin-top:20px;">
      <a href="${escapeHtml(INDEX_PAGE_URL)}" style="display:inline-block;margin:0 12px 8px 0;">Sign in</a>
      <a href="${escapeHtml(DASHBOARD_URL)}" style="display:inline-block;margin:0 12px 8px 0;">Open District Explorer dashboard</a>
    </p>
    <p style="color:#555;font-size:13px;">
      Sign-in page: ${escapeHtml(INDEX_PAGE_URL)}<br>
      Dashboard: ${escapeHtml(DASHBOARD_URL)}
    </p>
  `;
}

function buildUserEmail(body: UserUpdatePayload) {
  const name = body.name?.trim() || "there";
  const updatedBy = body.updated_by?.trim() || "an administrator";
  const changes = body.changes ?? [];
  const approved = isApproved(changes);

  const rows = changes.map(
    (c) =>
      `<tr><td><strong>${escapeHtml(c.field ?? "Field")}</strong></td><td>${escapeHtml(c.old_value ?? "—")}</td><td>${escapeHtml(c.new_value ?? "—")}</td></tr>`,
  ).join("");

  if (approved) {
    return {
      subject: "Your District Explorer access was approved",
      html: `
        <h2>Your access was approved</h2>
        <p>Hi ${escapeHtml(name)},</p>
        <p>
          ${escapeHtml(updatedBy)} approved your Perkins Eastman District Explorer account.
          Sign in with the email and password you created, then open the dashboard:
        </p>
        ${linksBlock()}
      `,
    };
  }

  return {
    subject: "Your dashboard profile was updated",
    html: `
      <h2>Your dashboard profile was updated</h2>
      <p>Hi ${escapeHtml(name)},</p>
      <p>Your Perkins Eastman dashboard account was updated by ${escapeHtml(updatedBy)}.</p>
      <table cellpadding="6" cellspacing="0" border="0">
        <tr><td><strong>Field</strong></td><td><strong>Previous</strong></td><td><strong>New</strong></td></tr>
        ${rows}
      </table>
      ${linksBlock()}
    `,
  };
}

Deno.serve(async (req) => {
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  if (!(await isAuthorized(req))) {
    return new Response("Unauthorized", { status: 401 });
  }

  if (!RESEND_API_KEY) {
    return new Response("RESEND_API_KEY is not configured", { status: 500 });
  }

  let body: UserUpdatePayload;
  try {
    body = await req.json();
  } catch {
    return new Response("Invalid JSON body", { status: 400 });
  }

  const toEmail = body.email?.trim();
  if (!toEmail) {
    return new Response("Recipient email is required", { status: 400 });
  }

  if (!body.changes?.length) {
    return new Response(JSON.stringify({ ok: true, skipped: true }), {
      headers: { "Content-Type": "application/json" },
    });
  }

  const { subject, html } = buildUserEmail(body);
  const userResult = await sendEmail(toEmail, subject, html);

  if (userResult.ok) {
    return new Response(
      JSON.stringify({ ok: true, to: toEmail, id: userResult.id }),
      { headers: { "Content-Type": "application/json" } },
    );
  }

  console.error("Resend error to user:", userResult.error, "to:", toEmail);

  const fallbackHtml = `
    <h2>Profile update (could not deliver to user)</h2>
    <p>Resend could not email <strong>${escapeHtml(toEmail)}</strong>. Please forward this to them.</p>
    ${html}
    <p style="color:#666;font-size:12px;">Resend error: ${escapeHtml(userResult.error)}</p>
  `;

  const fallbackResult = await sendEmail(
    NOTIFY_EMAIL,
    `[Forward to ${toEmail}] ${subject}`,
    fallbackHtml,
  );

  if (fallbackResult.ok) {
    return new Response(
      JSON.stringify({
        ok: true,
        to: toEmail,
        delivered_to: NOTIFY_EMAIL,
        forwarded: true,
        id: fallbackResult.id,
      }),
      { headers: { "Content-Type": "application/json" } },
    );
  }

  return new Response(userResult.error, { status: 502 });
});
