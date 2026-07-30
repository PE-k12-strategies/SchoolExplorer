import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.8";

/**
 * Sends signup / password-reset emails with confirm links that always point at
 * the hosted GitHub Pages app — bypasses locked Supabase Site URL / templates.
 *
 * Secrets:
 *   SUPABASE_SERVICE_ROLE_KEY  (required)
 *   RESEND_API_KEY             (required)
 *   FROM_EMAIL                 (optional)
 *   APP_BASE_URL               (optional; defaults to GitHub Pages)
 */

const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const APP_BASE_URL = (
  Deno.env.get("APP_BASE_URL")
  ?? "https://pe-k12-strategies.github.io/SchoolExplorer"
).replace(/\/$/, "");

const FROM_EMAIL = Deno.env.get("FROM_EMAIL") ?? "PE Dashboards <onboarding@resend.dev>";

type Action = "signup" | "recovery";

interface Body {
  action?: Action;
  email?: string;
  password?: string;
  name?: string;
  title?: string;
  role?: string;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function confirmPageUrl(tokenHash: string, type: string): string {
  const params = new URLSearchParams({
    token_hash: tokenHash,
    type,
  });
  return `${APP_BASE_URL}/auth-confirm.html?${params.toString()}`;
}

async function sendResend(to: string, subject: string, html: string) {
  const key = Deno.env.get("RESEND_API_KEY");
  if (!key) throw new Error("RESEND_API_KEY is not configured on the auth-email function");

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ from: FROM_EMAIL, to: [to], subject, html }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Resend failed: ${err}`);
  }
  return res.json();
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405, headers: corsHeaders });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceKey) {
    return new Response(
      JSON.stringify({ error: "Service role is not configured" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }

  let body: Body;
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: "Invalid JSON" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const action: Action = body.action === "recovery" ? "recovery" : "signup";
  const email = (body.email || "").trim().toLowerCase();
  if (!email || !email.includes("@")) {
    return new Response(JSON.stringify({ error: "Valid email is required" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const admin = createClient(supabaseUrl, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  try {
    if (action === "signup") {
      const password = String(body.password || "");
      if (password.length < 8) {
        return new Response(JSON.stringify({ error: "Password must be at least 8 characters" }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const { data, error } = await admin.auth.admin.generateLink({
        type: "signup",
        email,
        password,
        options: {
          data: {
            name: (body.name || "").trim(),
            title: (body.title || "").trim(),
            role: (body.role || "").trim(),
          },
          redirectTo: `${APP_BASE_URL}/index.html`,
        },
      });

      if (error) {
        return new Response(JSON.stringify({ error: error.message }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const tokenHash = data.properties?.hashed_token;
      if (!tokenHash) {
        return new Response(JSON.stringify({ error: "No confirmation token was generated" }), {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const link = confirmPageUrl(tokenHash, "signup");
      const name = (body.name || "").trim() || "there";
      await sendResend(
        email,
        "Confirm your School Explorer email",
        `
          <h2>Confirm your email</h2>
          <p>Hi ${escapeHtml(name)},</p>
          <p>Confirm your School Explorer account to finish signing up:</p>
          <p><a href="${escapeHtml(link)}">Confirm email address</a></p>
          <p>If you did not request this, you can ignore this email.</p>
        `,
      );

      return new Response(JSON.stringify({ ok: true, action: "signup" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // recovery
    const { data, error } = await admin.auth.admin.generateLink({
      type: "recovery",
      email,
      options: {
        redirectTo: `${APP_BASE_URL}/reset-password.html`,
      },
    });

    if (error) {
      // Do not reveal whether the email exists.
      console.warn("recovery generateLink:", error.message);
      return new Response(JSON.stringify({ ok: true, action: "recovery" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const tokenHash = data.properties?.hashed_token;
    if (tokenHash) {
      const link = confirmPageUrl(tokenHash, "recovery");
      await sendResend(
        email,
        "Reset your School Explorer password",
        `
          <h2>Reset your password</h2>
          <p>Use this link to choose a new password:</p>
          <p><a href="${escapeHtml(link)}">Reset password</a></p>
          <p>If you did not request this, you can ignore this email.</p>
        `,
      );
    }

    return new Response(JSON.stringify({ ok: true, action: "recovery" }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("auth-email error:", message);
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
