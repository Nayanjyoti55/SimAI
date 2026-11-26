// POST /api/username-check {username} -> { ok, why }
import { db } from "./_lib/db.mjs";
import { body, handler, json } from "./_lib/http.mjs";

export const USERNAME = /^[A-Za-z][A-Za-z0-9_.]{2,19}$/;

export default handler(async (req) => {
  const u = String((await body(req)).username || "").trim();
  if (!USERNAME.test(u)) return json({ ok: false, why: "3-20 letters, numbers, _ or . - starting with a letter." });
  const taken = await db.one("profiles", { username: u });
  return json(taken ? { ok: false, why: "That username is taken." } : { ok: true });
});

export const config = { path: "/api/username-check" };
