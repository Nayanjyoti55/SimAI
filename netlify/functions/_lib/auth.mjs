// Who is calling? (the browser sends its Supabase access token)
import { db } from "./db.mjs";
import { env, HttpError } from "./http.mjs";

let fakeUser = null;
export function setFakeUser(fn) { fakeUser = fn; }   // tests

export async function currentUser(req) {
  const h = req.headers.get("authorization") || "";
  const token = h.replace(/^Bearer\s+/i, "").trim();
  if (!token) throw new HttpError(401, "Please sign in first.");
  if (fakeUser) return fakeUser(token);
  const url = env("SUPABASE_URL").replace(/\/$/, "");
  const r = await fetch(`${url}/auth/v1/user`, {
    headers: { apikey: env("SUPABASE_ANON_KEY"), authorization: `Bearer ${token}` },
  });
  if (!r.ok) throw new HttpError(401, "Your sign-in has expired - please sign in again.");
  const user = await r.json();
  const profile = await db.one("profiles", { id: user.id });
  if (!profile) throw new HttpError(403, "No profile for this account.");
  if (profile.banned) throw new HttpError(403, "This account is blocked.");
  return { user, profile };
}

export async function requireAdmin(req) {
  const me = await currentUser(req);
  if (me.profile.role !== "admin") throw new HttpError(403, "Admins only.");
  return me;
}
