// POST /api/licence-prefs {key, machine | device, platform?, prefs?}
// v3.2: a few SIM settings kept WITH the licence, so reinstalling SIM (or a new PC) with the same key reconnects
// the same files folder and Google Drive by itself. Only these names, short text - never files, passwords or
// Google tokens. Only a device that is currently signed in to the key can read or change them.
import { failed, guard } from "./_lib/guard.mjs";
import { devicesOf, normDevice } from "./_lib/check.mjs";
import { db } from "./_lib/db.mjs";
import { normMachine, readKey } from "./_lib/licence.mjs";
import { body, handler, HttpError, json } from "./_lib/http.mjs";

export const PREF_KEYS = ["vault_root", "drive_mode", "drive_folder_link", "drive_folder_id", "drive_folder_name",
                          "drive_client_id"];

export function cleanPrefs(p) {
  const out = {};
  for (const k of PREF_KEYS) {
    if (p && typeof p[k] === "string") out[k] = p[k].slice(0, 400);
  }
  if (out.drive_mode && !["", "folder", "api"].includes(out.drive_mode)) delete out.drive_mode;
  return out;
}

export default handler(async (req) => {
  if (req.method !== "POST") throw new HttpError(405, "POST only");
  await guard(req);
  const b = await body(req);
  const r = readKey(String(b.key || ""));
  if (r.error) {
    await failed(req, "prefs");
    return json({ ok: false, reason: "invalid" }, 400);
  }
  const phone = b.platform === "android";
  const dev = phone ? normDevice(b.device) : normMachine(b.machine || b.device);
  const row = await db.one("licences", { kid: r.info.kid });
  if (!row || !dev) {
    await failed(req, "prefs");
    return json({ ok: false, reason: "unknown" }, 400);
  }
  const devs = await devicesOf(row);
  if (!devs.some((d) => d.device === dev && d.active)) {
    await failed(req, "prefs");
    return json({ ok: false, reason: "not_signed_in" }, 403);
  }
  let prefs = row.prefs && typeof row.prefs === "object" ? row.prefs : {};
  if (b.prefs && typeof b.prefs === "object") {
    prefs = { ...prefs, ...cleanPrefs(b.prefs) };
    await db.update("licences", { kid: row.kid }, { prefs });
  }
  return json({ ok: true, prefs });
});

export const config = { path: "/api/licence-prefs" };
