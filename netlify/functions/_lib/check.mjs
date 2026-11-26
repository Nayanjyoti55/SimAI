// One licence check for everything that asks "may this copy run?": the Windows installer, installed copies,
// the Android app and the shared AI brain.
//   platform "windows" (default): one PC per key       platform "android": one phone per key (separate slot)
// So a buyer can use the SAME key on his PC and on his phone.
import { db, settings } from "./db.mjs";
import { b32, describe, normMachine, readKey } from "./licence.mjs";

export const normDevice = (d) => String(d || "").toUpperCase().replace(/[^0-9A-Z]/g, "").slice(0, 40);

/** -> {ok:true, kid, valid, until, row} or {ok:false, reason} */
export async function checkLicence(key, { platform = "windows", device = "", activate = false, touch = true } = {}) {
  const r = readKey(String(key || ""));
  if (r.error) return { ok: false, reason: "invalid" };
  const info = r.info;
  const now = Math.floor(Date.now() / 1000);
  const phone = platform === "android";
  const dev = phone ? normDevice(device) : normMachine(device);
  // a key made for one particular PC only refuses OTHER PCs - the owner's phone is still fine
  if (!phone && info.bound && dev && b32(info.bound) !== dev) return { ok: false, reason: "other_pc" };
  const s = await settings();
  const row = await db.one("licences", { kid: info.kid });
  if (!row) {
    if (s.installer_check === false) {               // admin chose: any genuine key is fine
      if (info.notAfter && now > info.notAfter) return { ok: false, reason: "expired" };
      return { ok: true, kid: info.kid, valid: describe(info), until: info.notAfter || 0, registered: false };
    }
    return { ok: false, reason: "unknown" };
  }
  if (!row.enabled) return { ok: false, reason: "disabled" };
  let until = Number(row.not_after) || info.notAfter || 0;
  if (row.duration && row.activated_at) {
    const end = Math.floor(Date.parse(row.activated_at) / 1000) + Number(row.duration);
    until = until ? Math.min(until, end) : end;
  }
  if (until && now > until) return { ok: false, reason: "expired" };
  const onePer = s.one_pc_per_key !== false;
  if (phone) {
    if (onePer && row.activated_phone && dev && normDevice(row.activated_phone) !== dev) return { ok: false, reason: "used_phone" };
  } else {
    if (row.machine && dev && normMachine(row.machine) !== dev) return { ok: false, reason: "other_pc" };
    if (onePer && row.activated_machine && dev && normMachine(row.activated_machine) !== dev) return { ok: false, reason: "used" };
  }
  if (touch) {
    const patch = { last_seen: new Date().toISOString() };
    if (activate && dev) {
      if (phone && !row.activated_phone) { patch.activated_phone = dev; patch.phone_activated_at = patch.last_seen; }
      if (!phone && !row.activated_machine) patch.activated_machine = dev;
      if (!row.activated_at) {                        // first use on ANY device ("valid N days from first use" starts)
        patch.activated_at = patch.last_seen;
        if (row.duration) until = until ? Math.min(until, now + Number(row.duration)) : now + Number(row.duration);
      }
    }
    await db.update("licences", { kid: row.kid }, patch);
  }
  return { ok: true, kid: row.kid, valid: row.valid || describe(info), until, row };
}
