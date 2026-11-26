// GET /api/config - public settings the browser (and the desktop app) need.
import { db, secrets, settings } from "./_lib/db.mjs";
import { env, handler, json } from "./_lib/http.mjs";
import { publicKey } from "./_lib/licence.mjs";

const NEEDED_ENV = ["SUPABASE_URL", "SUPABASE_ANON_KEY", "SUPABASE_SERVICE_ROLE_KEY", "LICENCE_SIGNING_KEY"];

// ?check=1 (SIM's LICENSES checklist): is the latest schema.sql in, which settings are missing - names only, no values.
async function deepCheck(sec) {
  const tryQ = async (fn) => { try { await fn(); return true; } catch { return false; } };
  const [usage, phone] = await Promise.all([
    tryQ(() => db.select("ai_usage", {}, { limit: 1 })),
    tryQ(() => db.select("licences", {}, { limit: 1, columns: "kid,activated_phone" })),
  ]);
  return { schema_latest: usage && phone, env_missing: NEEDED_ENV.filter((k) => !env(k)),
           webhook_ready: !!sec.razorpay_webhook_secret };
}

export default handler(async (req) => {
  let s = {}, sec = {}, dbReady = false;
  try { s = await settings(); sec = await secrets(); dbReady = true; } catch { /* database not set up yet */ }
  const deep = new URL(req.url).searchParams.get("check") === "1" ? await deepCheck(sec) : {};
  let pub = "";
  try { pub = publicKey().toString("base64"); } catch { /* signing key not set yet */ }
  return json({
    supabase_url: env("SUPABASE_URL"), db_ready: dbReady, supabase_anon_key: env("SUPABASE_ANON_KEY"), public_key: pub,
    product_name: s.product_name || "S.I.M", tagline: s.tagline || "", made_by: s.made_by || "",
    powered_by: s.powered_by || "", support_email: s.support_email || "",
    payments_ready: !!(s.payments_enabled !== false && s.razorpay_key_id && sec.razorpay_key_secret),
    test_mode: String(s.razorpay_key_id || "").startsWith("rzp_test_"),
    refund_days: s.refund_days ?? 7,
    play_store_url: s.play_store_url || "", ...deep, ai_ready: s.ai_enabled !== false && !!(sec.groq_api_key || env("GROQ_API_KEY")),
  });
});

export const config = { path: "/api/config" };
