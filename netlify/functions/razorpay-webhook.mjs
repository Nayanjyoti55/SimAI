// POST /api/razorpay/webhook - Razorpay tells us the moment a QR is paid (qr_code.credited / payment.captured).
// We check the signature, then still ask Razorpay's API ourselves before giving a key.
// Razorpay dashboard › Account & Settings › Webhooks: URL https://<your-site>/api/razorpay/webhook,
// events qr_code.credited + payment.captured, secret = the webhook secret in admin › Settings.
import { db } from "./_lib/db.mjs";
import { handler, HttpError, json } from "./_lib/http.mjs";
import { confirmFromGateway } from "./_lib/pay.mjs";
import { hmac, keys, sameHex } from "./_lib/razorpay.mjs";

export default handler(async (req) => {
  const raw = await req.text();
  const k = await keys();
  if (!k.webhook || !sameHex(hmac(k.webhook, raw), req.headers.get("x-razorpay-signature") || ""))
    throw new HttpError(401, "bad signature");
  const ev = JSON.parse(raw || "{}");
  const qrId = ev?.payload?.qr_code?.entity?.id || ev?.payload?.payment?.entity?.notes?.qr_code_id || null;
  const orderId = ev?.payload?.qr_code?.entity?.notes?.order_id || ev?.payload?.payment?.entity?.notes?.order_id || null;
  let order = qrId ? await db.one("orders", { rzp_qr_id: qrId }) : null;
  if (!order && orderId) order = await db.one("orders", { id: orderId });
  if (!order) return json({ ok: true, ignored: "not one of our orders" });
  const was = order.status;
  if (was === "paid") return json({ ok: true, already: true });
  if (was === "expired" || was === "cancelled") {
    // paid just before the QR closed: it still counts - but only if Razorpay confirms it below
    await db.update("orders", { id: order.id, status: was }, { status: "pending" });
    order = { ...order, status: "pending" };
  }
  const res = await confirmFromGateway(order, "razorpay");
  if (!res && was !== "pending") await db.update("orders", { id: order.id, status: "pending" }, { status: was });
  return json({ ok: true, issued: !!res });
});

export const config = { path: "/api/razorpay/webhook" };
