// GET /api/orders/:id - the payment page asks "paid yet?" every ~2.5 s. Each time we ask RAZORPAY (not the
// browser): only a payment Razorpay reports as captured, for this order's QR and exact amount, gives a key.
// POST /api/orders/:id {action: "cancel"}
import { currentUser } from "./_lib/auth.mjs";
import { db } from "./_lib/db.mjs";
import { body, handler, HttpError, json } from "./_lib/http.mjs";
import { confirmFromGateway } from "./_lib/pay.mjs";
import { closeQr, keys } from "./_lib/razorpay.mjs";
import { publicOrder } from "./orders-create.mjs";

export default handler(async (req, context) => {
  const { profile } = await currentUser(req);
  const id = context?.params?.id || new URL(req.url).pathname.split("/").pop();
  let order = await db.one("orders", { id });
  if (!order || (order.user_id !== profile.id && profile.role !== "admin")) throw new HttpError(404, "No such order.");
  if (req.method === "POST" && (await body(req)).action === "cancel") {
    // last look first: if it was paid a moment ago, it's NOT cancelled
    if (order.status === "pending") await confirmFromGateway(order, "check").catch(() => null);
    const done = await db.update("orders", { id, status: "pending" }, { status: "cancelled" });
    if (done?.length && order.rzp_qr_id) await closeQr(await keys(), order.rzp_qr_id);
    order = await db.one("orders", { id });
    return json({ order: publicOrder(order) });
  }
  if (order.status === "pending") {
    await confirmFromGateway(order, "check").catch((e) => console.error("gateway check:", e.message));
    order = await db.one("orders", { id });
    if (order.status === "pending" && Date.parse(order.expires_at) < Date.now() - 2 * 60e3) {
      await db.update("orders", { id, status: "pending" }, { status: "expired" });
      order.status = "expired";
    }
  }
  let licence = null;
  if (order.licence_kid) licence = await db.one("licences", { kid: order.licence_kid });
  return json({ order: publicOrder(order), licence: licence ? { kid: licence.kid, key: licence.key,
                                                                valid: licence.valid, enabled: licence.enabled } : null });
});

export const config = { path: "/api/orders/:id" };
