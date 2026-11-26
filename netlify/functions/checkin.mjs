// POST /api/checkin - the small security check-in an installed copy sends (shown to its user at install):
// licence id, app version, AI name, Windows version, a one-way PC code, failed unlock attempts, status.
import { db } from "./_lib/db.mjs";
import { body, handler, HttpError, json } from "./_lib/http.mjs";

const cut = (v, n) => (v === undefined || v === null ? null : String(v).slice(0, n));

export default handler(async (req) => {
  if (req.method !== "POST") throw new HttpError(405, "POST only");
  const b = await body(req);
  if (!/^[0-9a-f]{16}$/.test(String(b.kid || ""))) throw new HttpError(400, "bad licence id");
  const lic = await db.one("licences", { kid: b.kid });
  if (!lic) return json({ ok: false, reason: "unknown" });
  await db.insert("checkins", {
    kid: b.kid, machine: cut(b.machine, 24), app_version: cut(b.app_version, 20), ai_name: cut(b.ai_name, 30),
    os: cut(b.os, 80), unlock_fails: Number.isFinite(+b.unlock_fails) ? Math.min(+b.unlock_fails, 9999) : null,
    status: cut(b.status, 20),
  });
  await db.update("licences", { kid: b.kid }, { last_seen: new Date().toISOString() });
  return json({ ok: true });
});

export const config = { path: "/api/checkin" };
