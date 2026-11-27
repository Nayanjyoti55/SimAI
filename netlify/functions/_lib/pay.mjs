// Orders -> confirmed payment -> licence key.  A key is ONLY made after Razorpay's own servers say the payment
// for this exact order is "captured" (money received), for exactly the order's amount, and not used before.
import crypto from "node:crypto";
import { audit, db, op, settings } from "./db.mjs";
import { describe, makeKey } from "./licence.mjs";
import { capture, keys, qrPayments } from "./razorpay.mjs";

const CODE_CHARS = "23456789ABCDEFGHJKMNPQRSTVWXYZ";
export function orderCode(prefix = "SIM") {
  const b = crypto.randomBytes(5);
  return `${prefix}-` + [...b].map((x) => CODE_CHARS[x % CODE_CHARS.length]).join("");
}

/** Ask Razorpay whether this order's QR has been paid. Returns the fulfilment, or null if not paid (yet). */
export async function confirmFromGateway(order, source = "check") {
  if (!order || order.status !== "pending" || !order.rzp_qr_id) return null;
  const k = await keys();
  const list = await qrPayments(k, order.rzp_qr_id);
  for (let p of list.items || []) {
    if (p.amount !== order.amount_paise || (p.currency && p.currency !== "INR")) continue;
    if (p.status === "authorized") p = await capture(k, p.id, p.amount);   // money held -> take it
    if (p.status !== "captured") continue;
    const used = await db.one("orders", { razorpay_payment_id: p.id });
    if (used && used.id !== order.id) continue;                           // never one payment for two orders
    return fulfil(order, { utr: p.acquirer_data?.rrn || null, payer: p.vpa || p.email || null,
                           paymentId: p.id, source });
  }
  return null;
}

/** Payment confirmed -> order paid (exactly once, even if the webhook and the page check at the same moment)
 *  -> licence key. */
export async function fulfil(order, { utr = null, payer = null, paymentId = null, source = "razorpay", note = "" } = {}) {
  const now = new Date();
  const updated = await db.update("orders", { id: order.id, status: "pending" },
                                  { status: "paid", utr, payer, razorpay_payment_id: paymentId, paid_at: now.toISOString() });
  if (!updated?.length) return null;                      // someone else already completed it
  const o = updated[0];
  const s = await settings();
  const plan = await db.one("plans", { id: o.plan_id });
  const days = plan?.duration_days ?? 30;
  const nowS = Math.floor(now.getTime() / 1000);
  const notBefore = nowS;
  let notAfter = days ? nowS + days * 86400 : 0;
  let old = null;
  if (o.kind === "renew" && o.renew_kid) {
    old = await db.one("licences", { kid: o.renew_kid, user_id: o.user_id });
    if (old && days) notAfter = Math.max(nowS, Number(old.not_after) || nowS) + days * 86400;
    if (old && !days) notAfter = 0;
  }
  const { key, info } = makeKey({ notBefore, notAfter });
  const buyer = await db.one("profiles", { id: o.user_id });
  await db.insert("licences", {
    kid: info.kid, key, user_id: o.user_id, order_id: o.id, plan_id: o.plan_id,
    for_whom: buyer?.username || buyer?.email || "", note: `${plan?.name || ""} · ${o.code}${note ? " · " + note : ""}`,
    valid: describe(info), not_before: notBefore, not_after: notAfter, duration: 0,
    enabled: s.auto_issue !== false, source: "web",
    max_devices: Math.max(1, Number(plan?.max_devices) || 2),
  });
  if (old) {
    await db.update("licences", { kid: old.kid }, { enabled: false, renewed_to: info.kid });
    // ...and its saved SIM settings (files folder / Google Drive link)
    if (old.prefs && Object.keys(old.prefs).length) {
      try { await db.update("licences", { kid: info.kid }, { prefs: old.prefs }); } catch { /* older schema */ }
    }
    // the renewed key keeps the devices of the old one (they switch over by themselves)
    try {
      const devs = (await db.select("licence_devices", { kid: old.kid, active: true })) || [];
      if (devs.length) await db.upsert("licence_devices", devs.slice(0, Math.max(1, Number(plan?.max_devices) || 2))
        .map((d) => ({ kid: info.kid, device: d.device, platform: d.platform, name: d.name, active: true })), "kid,device");
    } catch { /* older schema */ }
  }
  const invoice = `INV-${now.toISOString().slice(0, 10).replace(/-/g, "")}-${o.code.split("-").pop()}`;
  await db.update("orders", { id: o.id }, { licence_kid: info.kid, invoice_no: invoice });
  await db.insert("payment_events", { source, raw: paymentId ? `Razorpay payment ${paymentId}` : note || source,
                                      amount_paise: o.amount_paise, utr, payer, order_id: o.id, status: "matched",
                                      note: `licence ${info.kid}` });
  await audit(source, "order_paid", { order: o.code, amount_paise: o.amount_paise, payment: paymentId, kid: info.kid });
  return { order: { ...o, licence_kid: info.kid, invoice_no: invoice }, key, kid: info.kid };
}

/** Orders whose time ran out are tidied up whenever someone looks (a late payment is still checked first). */
export async function expireOld() {
  try {
    await db.update("orders", { status: "pending", expires_at: op("lt", new Date(Date.now() - 10 * 60e3).toISOString()) },
                    { status: "expired" });
  } catch { /* best effort */ }
}
