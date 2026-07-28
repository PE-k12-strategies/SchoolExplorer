import "jsr:@supabase/functions-js/edge-runtime.d.ts";

// Who can approve on admin.html (sign in with this email in Supabase Auth)
const ADMIN_EMAIL = "k12strategies@perkinseastman.com";

const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY");
const NOTIFY_SECRET = Deno.env.get("NOTIFY_SECRET");
const FROM_EMAIL = Deno.env.get("FROM_EMAIL") ?? "PE Dashboards <onboarding@resend.dev>";
const ADMIN_PAGE_URL = Deno.env.get("ADMIN_PAGE_URL") ?? "";

// Where to send alerts now. Use your email until k12strategies@ mailbox exists.
// Later switch to k12strategies@perkinseastman.com (needs Resend domain or Office 365).
function getNotifyEmail(): string {
  return Deno.env.get("NOTIFY_EMAIL") ?? "d.wieberdink@perkinseastman.com";
}

interface SignupPayload {
  name?: string;
  email?: string;
  title?: string;
  role?: string;
  user_id?: number;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

Deno.serve(async (req) => {
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  const secret = req.headers.get("x-notify-secret");
  if (!NOTIFY_SECRET || secret !== NOTIFY_SECRET) {
    return new Response("Unauthorized", { status: 401 });
  }

  if (!RESEND_API_KEY) {
    return new Response("RESEND_API_KEY is not configured", { status: 500 });
  }

  let body: SignupPayload;
  try {
    body = await req.json();
  } catch {
    return new Response("Invalid JSON body", { status: 400 });
  }

  const name = body.name?.trim() || "Unknown";
  const email = body.email?.trim() || "Unknown";
  const title = body.title?.trim() || "—";
  const role = body.role?.trim() || "—";
  const notifyEmail = getNotifyEmail();

  const reviewBlock = ADMIN_PAGE_URL
    ? `<p><a href="${escapeHtml(ADMIN_PAGE_URL)}">Open admin page</a></p>`
    : "<p>Open the admin approval page to approve or reject.</p>";

  const html = `
    <h2>New dashboard access request</h2>
    <p>Someone requested access to Perkins Eastman dashboards.</p>
    <table cellpadding="6" cellspacing="0" border="0">
      <tr><td><strong>Name</strong></td><td>${escapeHtml(name)}</td></tr>
      <tr><td><strong>Email</strong></td><td>${escapeHtml(email)}</td></tr>
      <tr><td><strong>Title</strong></td><td>${escapeHtml(title)}</td></tr>
      <tr><td><strong>Role</strong></td><td>${escapeHtml(role)}</td></tr>
    </table>
    ${reviewBlock}
    <p>Sign in as <strong>${ADMIN_EMAIL}</strong> to approve (Supabase password — not Outlook).</p>
  `;

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${RESEND_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: FROM_EMAIL,
      to: [notifyEmail],
      subject: `New dashboard access request: ${name}`,
      html,
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    console.error("Resend error:", err);
    return new Response(err, { status: 502 });
  }

  const data = await res.json();
  return new Response(
    JSON.stringify({ ok: true, to: notifyEmail, admin: ADMIN_EMAIL, id: data.id }),
    { headers: { "Content-Type": "application/json" } },
  );
});
