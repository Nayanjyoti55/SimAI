// POST /api/login {username | email, password} - sign in with a USERNAME (Supabase itself only knows e-mails).
// Used by the website and by the desktop app (master admin sign-in / restore).
import { failed, guard } from "./_lib/guard.mjs";
import { db } from "./_lib/db.mjs";
import { body, env, handler, HttpError, json } from "./_lib/http.mjs";

export default handler(async (req) => {
  if (req.method !== "POST") throw new HttpError(405, "POST only");
  await guard(req);                                                  // v3.2: password guessers get blocked
  const b = await body(req);
  const who = String(b.username || b.email || "").trim();
  const password = String(b.password || "");
  if (!who || !password) throw new HttpError(400, "Type your username (or e-mail) and password.");
  let email = who;
  if (!who.includes("@")) {
    const p = await db.one("profiles", { username: who });          // citext: any letter case
    if (!p?.email) { await failed(req, "login"); throw new HttpError(401, "Wrong username or password."); }
    email = p.email;
  }
  const url = env("SUPABASE_URL").replace(/\/$/, "");
  const r = await fetch(`${url}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: { apikey: env("SUPABASE_ANON_KEY"), "content-type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) {
    const msg = /confirm/i.test(d.error_description || d.msg || "") ? "Confirm your e-mail first (check your inbox)."
      : "Wrong username or password.";
    await failed(req, "login");
    throw new HttpError(401, msg);
  }
  const profile = await db.one("profiles", { id: d.user.id });
  if (profile?.banned) throw new HttpError(403, "This account is blocked.");
  return json({
    access_token: d.access_token, refresh_token: d.refresh_token,
    expires_at: d.expires_at || Math.floor(Date.now() / 1000) + (d.expires_in || 3600),
    user: { id: d.user.id, email: d.user.email },
    profile: profile ? { username: profile.username, role: profile.role } : null,
  });
});

export const config = { path: "/api/login" };
