// POST /api/orders {plan_id, renew_kid?} - start buying / renewing a licence: makes the order and its own
// single-use UPI QR (exact amount, closes when the time is up).
import { currentUser } from "./_lib/auth.mjs";
import { db, op, settings } from "./_lib/db.mjs";
import { body, handler, HttpError, json } from "./_lib/http.mjs";
import { expireOld, orderCode } from "./_lib/pay.mjs";
import { createQr, keys } from "./_lib/razorpay.mjs";

export const publicOrder = (o) => ({
  id: o.id, code: o.code, plan_id: o.plan_id, kind: o.kind, renew_kid: o.renew_kid, amount_paise: o.amount_paise,
  status: o.status, created_at: o.created_at, expires_at: o.expires_at, paid_at: o.paid_at, utr: o.utr,
  invoice_no: o.invoice_no, licence_kid: o.licence_kid, qr_image: o.rzp_qr_image, upi_link: o.rzp_qr_content,
});

export default handler(async (req) => {
  if (req.method !== "POST") throw new HttpError(405, "POST only");
  const { profile } = await currentUser(req);
  const b = await body(req);
  const s = await settings();
  if (s.payments_enabled === false) throw new HttpError(503, "Sales are paused right now - please try again later.");
  const plan = await db.one("plans", { id: String(b.plan_id || ""), active: true });
  if (!plan) throw new HttpError(404, "That plan isn't available.");
  let renew = null;
  if (b.renew_kid) {
    renew = await db.one("licences", { kid: String(b.renew_kid), user_id: profile.id });
    if (!renew) throw new HttpError(404, "That licence isn't yours.");
  }
  await expireOld();
  // the same person, plan and renewal with time left on its QR: show that one again
  const open = await db.select("orders", { user_id: profile.id, status: "pending", plan_id: plan.id,
                                           expires_at: op("gt", new Date(Date.now() + 3 * 60e3).toISOString()) }, { limit: 1 });
  if (open?.length && (open[0].renew_kid || null) === (renew?.kid || null) && open[0].rzp_qr_id)
    return json({ order: publicOrder(open[0]), reused: true });
  const k = await keys();
  const minutes = Math.max(5, Math.min(60, Number(s.payment_window_min) || 15));
  const expires = new Date(Date.now() + minutes * 60e3);
  const prefix = (s.product_name || "SIM").replace(/[^A-Za-z]/g, "").slice(0, 4).toUpperCase() || "SIM";
  const order = await db.insert("orders", {
    code: orderCode(prefix), user_id: profile.id, plan_id: plan.id, kind: renew ? "renew" : "new",
    renew_kid: renew?.kid || null, method: "upi", base_paise: plan.price_paise, amount_paise: plan.price_paise,
    expires_at: expires.toISOString(),
  });
  let qr;
  try {
    qr = await createQr(k, { amount: plan.price_paise, code: order.code, closeBy: Math.floor(expires.getTime() / 1000) + 60,
                             name: `${s.product_name || "SIM"} ${plan.name}`, notes: { order_id: order.id } });
  } catch (e) {
    await db.update("orders", { id: order.id }, { status: "cancelled" });
    throw e;
  }
  const [saved] = await db.update("orders", { id: order.id }, {
    rzp_qr_id: qr.id, rzp_qr_image: qr.image_url || null, rzp_qr_content: qr.image_content || null });
  return json({ order: publicOrder(saved) });
});

export const config = { path: "/api/orders" };
