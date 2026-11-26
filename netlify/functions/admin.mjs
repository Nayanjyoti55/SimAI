// POST /api/admin/:action  - things only the website admin may do, which need the server's secrets.
// (Plain edits - plans, releases, site settings, switching keys on/off - are done straight from the admin
//  page; the database's row-level security lets only the admin do them.)
import crypto from "node:crypto";
import { requireAdmin } from "./_lib/auth.mjs";
import { audit, db, op, secrets, settings } from "./_lib/db.mjs";
import { body, env, handler, HttpError, json } from "./_lib/http.mjs";
import { describe, makeKey, normMachine, seed, unb32 } from "./_lib/licence.mjs";
import { confirmFromGateway, fulfil } from "./_lib/pay.mjs";
import { keys, listQrs } from "./_lib/razorpay.mjs";

const DAY = 86400;

async function userByName(name) {
  if (!name) return null;
  const n = String(name).trim();
  return (await db.one("profiles", n.includes("@") ? { email: n } : { username: n })) || null;
}

function validity(b) {
  const now = Math.floor(Date.now() / 1000);
  if (b.from && b.to) {
    const nb = Math.floor(Date.parse(b.from) / 1000), na = Math.floor(Date.parse(b.to) / 1000);
    if (!(na > nb)) throw new HttpError(400, "The end must be after the start.");
    return { notBefore: nb, notAfter: na, duration: 0 };
  }
  const secs = Math.round(Number(b.seconds || 0) || Number(b.days || 0) * DAY);
  if (!secs) return { notBefore: now, notAfter: 0, duration: 0 };               // lifetime
  return b.start === "now" ? { notBefore: now, notAfter: now + secs, duration: 0 } : { notBefore: 0, notAfter: 0, duration: secs };
}

const actions = {
  async "signing-key"(b, me) {
    await audit(me.profile.username, "signing_key_fetched", {});
    return { signing_key: seed().toString("hex") };
  },

  async "issue-key"(b, me) {
    const v = validity(b);
    let machine = null;
    if (b.machine) {
      machine = unb32(normMachine(b.machine)).subarray(0, 8);
      if (machine.length !== 8) throw new HttpError(400, "That PC code isn't valid.");
    }
    const owner = await userByName(b.user);
    const { key, info } = makeKey({ ...v, machine });
    const row = await db.insert("licences", {
      kid: info.kid, key, user_id: owner?.id || null, for_whom: b.for_whom || owner?.username || "",
      note: b.note || "", valid: describe(info), not_before: v.notBefore, not_after: v.notAfter, duration: v.duration,
      machine: b.machine ? normMachine(b.machine) : "", enabled: true, source: "admin", plan_id: b.plan_id || null,
    });
    await audit(me.profile.username, "key_issued", { kid: info.kid, for: row.for_whom });
    return { key, licence: row };
  },

  async "replace-key"(b, me) {                    // extend / change validity: a new key, the old one switched off
    const old = await db.one("licences", { kid: String(b.kid || "") });
    if (!old) throw new HttpError(404, "No such licence.");
    const v = validity(b);
    const { key, info } = makeKey(v);
    const row = await db.insert("licences", { ...old, kid: info.kid, key, valid: describe(info), not_before: v.notBefore,
                                              not_after: v.notAfter, duration: v.duration, enabled: true,
                                              activated_machine: null, activated_at: null, activated_phone: null, phone_activated_at: null, renewed_to: null,
                                              created_at: new Date().toISOString(), source: "admin" });
    await db.update("licences", { kid: old.kid }, { enabled: false, renewed_to: info.kid });
    await audit(me.profile.username, "key_replaced", { old: old.kid, new: info.kid });
    return { key, licence: row };
  },

  async "reset-pc"(b, me) {
    await db.update("licences", { kid: String(b.kid || "") }, { activated_machine: null });
    await audit(me.profile.username, "pc_reset", { kid: b.kid });
    return { ok: true };
  },

  async "reset-phone"(b, me) {                    // the buyer changed phones
    await db.update("licences", { kid: String(b.kid || "") }, { activated_phone: null, phone_activated_at: null });
    await audit(me.profile.username, "phone_reset", { kid: b.kid });
    return { ok: true };
  },

  async "ai-usage"() {                            // today's shared-brain use, busiest keys first
    const day = new Date().toISOString().slice(0, 10);
    const rows = await db.select("ai_usage", { day }, { order: "requests.desc", limit: 50 });
    return { day, rows, total: rows.reduce((a, r) => a + (r.requests || 0), 0) };
  },

  async "mark-paid"(b, me) {
    const o = await db.one("orders", { id: String(b.order_id || "") });
    if (!o) throw new HttpError(404, "No such order.");
    if (o.status !== "pending" && o.status !== "expired") throw new HttpError(409, `This order is ${o.status}.`);
    if (o.status === "expired") await db.update("orders", { id: o.id }, { status: "pending" });
    // for money you received some other way (cash, bank transfer) - your decision, logged with your name
    const res = await fulfil({ ...o, status: "pending" }, { utr: b.utr || null, source: "manual",
                                                            note: `marked paid by ${me.profile.username}${b.note ? ": " + b.note : ""}` });
    if (!res) throw new HttpError(409, "Already completed.");
    return res;
  },

  async recheck(b, me) {                      // "the buyer says they paid": ask Razorpay again right now
    let o = await db.one("orders", { id: String(b.order_id || "") });
    if (!o) throw new HttpError(404, "No such order.");
    if (o.status === "paid") return { status: "paid", order: o };
    const was = o.status;
    if (was === "expired" || was === "cancelled") await db.update("orders", { id: o.id, status: was }, { status: "pending" });
    const res = await confirmFromGateway({ ...o, status: "pending" }, "admin-recheck");
    if (!res && was !== "pending") await db.update("orders", { id: o.id, status: "pending" }, { status: was });
    await audit(me.profile.username, "order_rechecked", { order: o.code, paid: !!res });
    return res ? { status: "paid", ...res } : { status: was, message: "Razorpay has no completed payment for this order." };
  },

  async "test-razorpay"() {                    // are the keys right?
    const k = await keys();
    await listQrs(k);
    return { ok: true, test_mode: k.test, webhook_secret_set: !!k.webhook };
  },

  async "secrets-get"() {
    const s = await secrets();
    return { razorpay_key_secret_set: !!s.razorpay_key_secret, razorpay_webhook_secret_set: !!s.razorpay_webhook_secret,
             groq_api_key_set: !!(s.groq_api_key || env("GROQ_API_KEY")) };
  },

  async "secrets-set"(b, me) {
    const patch = {};
    let generated = null;
    if (typeof b.razorpay_key_secret === "string" && b.razorpay_key_secret) patch.razorpay_key_secret = b.razorpay_key_secret.trim();
    if (typeof b.razorpay_webhook_secret === "string" && b.razorpay_webhook_secret) patch.razorpay_webhook_secret = b.razorpay_webhook_secret.trim();
    if (typeof b.groq_api_key === "string" && b.groq_api_key) patch.groq_api_key = b.groq_api_key.trim();
    if (b.generate_webhook_secret) patch.razorpay_webhook_secret = generated = crypto.randomBytes(18).toString("base64url");
    if (Object.keys(patch).length) await db.update("secret_settings", { id: 1 }, patch);
    await audit(me.profile.username, "secrets_changed", { fields: Object.keys(patch) });
    return { ...(await actions["secrets-get"]()), generated_webhook_secret: generated };
  },

  async "set-user"(b, me) {
    const patch = {};
    if (b.role === "admin" || b.role === "user") patch.role = b.role;
    if (typeof b.banned === "boolean") patch.banned = b.banned;
    if (String(b.id) === me.profile.id && (patch.role === "user" || patch.banned)) throw new HttpError(400, "You can't demote or block yourself.");
    const rows = await db.update("profiles", { id: String(b.id || "") }, patch);
    await audit(me.profile.username, "user_changed", { id: b.id, ...patch });
    return { profile: rows?.[0] || null };
  },

  async stats() {
    const paid = await db.select("orders", { status: "paid" }, { columns: "amount_paise,paid_at", limit: 10000 });
    const day = new Date(); day.setHours(0, 0, 0, 0);
    const month = new Date(day.getFullYear(), day.getMonth(), 1);
    const sum = (rows) => rows.reduce((a, o) => a + (o.amount_paise || 0), 0);
    const lic = await db.select("licences", {}, { columns: "enabled,last_seen", limit: 10000 });
    const recent = Date.now() - 24 * 3600e3;
    const users = await db.select("profiles", {}, { columns: "id", limit: 100000 });
    const rel = await db.select("releases", {}, { columns: "downloads", limit: 1000 });
    const pending = await db.select("orders", { status: "pending", expires_at: op("gt", new Date().toISOString()) },
                                    { columns: "id", limit: 1000 });
    return {
      revenue_today: sum(paid.filter((o) => new Date(o.paid_at) >= day)),
      revenue_month: sum(paid.filter((o) => new Date(o.paid_at) >= month)),
      revenue_total: sum(paid), orders_paid: paid.length, orders_waiting: pending.length,
      licences_active: lic.filter((l) => l.enabled).length,
      copies_online_24h: lic.filter((l) => l.last_seen && Date.parse(l.last_seen) > recent).length,
      users: users.length, downloads: rel.reduce((a, r) => a + (r.downloads || 0), 0),
    };
  },
};

export default handler(async (req, context) => {
  if (req.method !== "POST") throw new HttpError(405, "POST only");
  const me = await requireAdmin(req);
  const action = context?.params?.action || new URL(req.url).pathname.split("/").pop();
  const fn = actions[action];
  if (!fn) throw new HttpError(404, "Unknown admin action.");
  return json(await fn(await body(req), me));
});

export const config = { path: "/api/admin/:action" };
export { actions as _actions };
