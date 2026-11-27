// One licence check for everything that asks "may this copy run?": the Windows installer, installed copies,
// the Android app and the shared AI brain.
//
// v3.2 - devices per key: each key has `max_devices` slots (from its plan, e.g. 1 month = 2 devices). A PC or phone
// takes a slot when it activates the key and keeps it until it signs out / is uninstalled / is removed in
// "My licences". A new device gets in only while a slot is free - so an accidental uninstall never locks anyone out.
import { db, settings } from "./db.mjs";
import { b32, describe, normMachine, readKey } from "./licence.mjs";

export const normDevice = (d) => String(d || "").toUpperCase().replace(/[^0-9A-Z]/g, "").slice(0, 40);
const nowIso = () => new Date().toISOString();

/** Devices of a key; keys activated before v3.2 (activated_machine / activated_phone) are brought over once. */
export async function devicesOf(row) {
  let rows = (await db.select("licence_devices", { kid: row.kid })) || [];
  if (!rows.length && (row.activated_machine || row.activated_phone)) {
    const seed = [];
    if (row.activated_machine) seed.push({ kid: row.kid, device: normMachine(row.activated_machine), platform: "windows",
                                           name: "PC", active: true });
    if (row.activated_phone) seed.push({ kid: row.kid, device: normDevice(row.activated_phone), platform: "android",
                                         name: "Phone", active: true });
    await db.upsert("licence_devices", seed, "kid,device");
    rows = seed;
  }
  return rows;
}

const slotList = (devs) => devs.filter((d) => d.active).map((d) => ({
  name: d.name || (d.platform === "android" ? "Phone" : "PC"), platform: d.platform, last_seen: d.last_seen || null }));

/** -> {ok:true, kid, valid, until, row, devices_used, max_devices} or {ok:false, reason, ...} */
export async function checkLicence(key, { platform = "windows", device = "", name = "", activate = false, touch = true } = {}) {
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
  const devs = dev ? await devicesOf(row) : [];
  const mine = devs.find((d) => d.device === dev);
  if (!row.enabled) {
    // renewed: a device that used the old key gets the new one automatically (it's the buyer's own device)
    if (row.renewed_to && mine) {
      const next = await db.one("licences", { kid: row.renewed_to });
      if (next?.enabled) return { ok: false, reason: "renewed", new_key: next.key, kid: next.kid };
    }
    return { ok: false, reason: "disabled" };
  }
  let until = Number(row.not_after) || info.notAfter || 0;
  if (row.duration && row.activated_at) {
    const end = Math.floor(Date.parse(row.activated_at) / 1000) + Number(row.duration);
    until = until ? Math.min(until, end) : end;
  }
  if (until && now > until) return { ok: false, reason: "expired", until };
  if (!phone && row.machine && dev && normMachine(row.machine) !== dev) return { ok: false, reason: "other_pc" };

  const limits = s.one_pc_per_key !== false;           // admin switch: "limit devices per key"
  const max = Math.max(1, Number(row.max_devices) || 2);
  const active = devs.filter((d) => d.active);
  const patch = {};
  if (dev && limits) {
    if (mine?.active) {
      if (touch) await db.update("licence_devices", { kid: row.kid, device: dev }, { last_seen: nowIso(),
                                                                                    ...(name ? { name } : {}) });
    } else if (mine && !mine.active && !activate) {
      return { ok: false, reason: "device_removed", max_devices: max, devices: slotList(devs) };
    } else if (activate || !devs.length) {
      if (active.length >= max) return { ok: false, reason: "device_limit", max_devices: max, devices: slotList(devs) };
      if (touch) {
        await db.upsert("licence_devices", [{ kid: row.kid, device: dev, platform: phone ? "android" : "windows",
                                              name: String(name || (phone ? "Phone" : "PC")).slice(0, 60),
                                              active: true, released_at: null, last_seen: nowIso(),
                                              ...(mine ? {} : { first_seen: nowIso() }) }], "kid,device");
        if (phone && !row.activated_phone) { patch.activated_phone = dev; patch.phone_activated_at = nowIso(); }
        if (!phone && !row.activated_machine) patch.activated_machine = dev;
      }
    } else {
      // an older copy that never registered this device: let it in while a slot is free
      if (active.length >= max) return { ok: false, reason: "device_limit", max_devices: max, devices: slotList(devs) };
      if (touch) await db.upsert("licence_devices", [{ kid: row.kid, device: dev, platform: phone ? "android" : "windows",
                                                       name: String(name || (phone ? "Phone" : "PC")).slice(0, 60),
                                                       active: true, last_seen: nowIso() }], "kid,device");
    }
  }
  if (touch) {
    patch.last_seen = nowIso();
    if (activate && dev && !row.activated_at) {        // first use on ANY device ("valid N days from first use" starts)
      patch.activated_at = patch.last_seen;
      if (row.duration) until = until ? Math.min(until, now + Number(row.duration)) : now + Number(row.duration);
    }
    await db.update("licences", { kid: row.kid }, patch);
  }
  const used = dev && limits ? (await db.select("licence_devices", { kid: row.kid, active: true }) || []).length : active.length;
  return { ok: true, kid: row.kid, valid: row.valid || describe(info), until, row, devices_used: used, max_devices: max };
}

/** Free a device's slot (sign-out in SIM, uninstall, or "Remove" in My licences). */
export async function releaseDevice(key, device, platform = "windows") {
  const r = readKey(String(key || ""));
  if (r.error) return { ok: false, reason: "invalid" };
  const dev = platform === "android" ? normDevice(device) : normMachine(device);
  if (!dev) return { ok: false, reason: "no_device" };
  const row = await db.one("licences", { kid: r.info.kid });
  if (!row) return { ok: false, reason: "unknown" };
  await devicesOf(row);
  const done = await db.update("licence_devices", { kid: row.kid, device: dev }, { active: false, released_at: nowIso() });
  const patch = {};
  if (row.activated_machine && normMachine(row.activated_machine) === dev) patch.activated_machine = null;
  if (row.activated_phone && normDevice(row.activated_phone) === dev) patch.activated_phone = null;
  if (Object.keys(patch).length) await db.update("licences", { kid: row.kid }, patch);
  return { ok: true, released: (done || []).length };
}

export const REASON_TEXT = {
  invalid: "This isn't a valid licence key.",
  unknown: "This key isn't registered.",
  disabled: "This key is switched off.",
  expired: "This licence has expired - renew it in your account.",
  other_pc: "This key belongs to a different PC.",
  device_limit: "This key is already in use on its maximum number of devices. Sign out on one of them, or remove one in My licences.",
  device_removed: "This device was signed out of the licence. Activate the key again to use it here.",
  renewed: "This key was renewed - the new key is used automatically.",
};
