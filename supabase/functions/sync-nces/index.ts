import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.49.8";
import { createLogger } from "../../../nces-sync/src/lib/logger.ts";
import { runSync } from "../../../nces-sync/src/sync/run-sync.ts";

const SYNC_SECRET = Deno.env.get("SYNC_SECRET");

Deno.serve(async (req) => {
  if (req.method !== "POST") {
    return json({ error: "POST only" }, 405);
  }

  if (!SYNC_SECRET || req.headers.get("x-sync-secret") !== SYNC_SECRET) {
    return json({ error: "Unauthorized" }, 401);
  }

  const url = Deno.env.get("SUPABASE_URL");
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !key) {
    return json({ error: "Missing Supabase env" }, 500);
  }

  let leaid: string | undefined;
  try {
    const body = await req.json().catch(() => ({}));
    leaid = body?.leaid;
  } catch {
    /* empty body ok */
  }

  const logger = createLogger(true);
  const supabase = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  try {
    const summary = await runSync({ leaid, verbose: true, logger, supabase });
    return json({
      ok: !summary.hadErrors,
      totalUpserted: summary.totalUpserted,
      results: summary.results,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return json({ error: message }, 500);
  }
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
