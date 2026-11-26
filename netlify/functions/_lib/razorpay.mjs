// Razorpay - the payment gateway that tells the website, for certain, that a payment really arrived.
// We use its UPI QR Codes API: one QR per order, for exactly that amount, usable once, closing after the time limit.
// The money goes to YOUR bank account (Razorpay settles it); Razorpay confirms each payment to us.
import crypto from "node:crypto";
import { secrets, settings } from "./db.mjs";
import { HttpError } from "./http.mjs";

let fakeFetch = null;
export function setFetch(f) { fakeFetch = f; }        // tests
const go = (...a) => (fakeFetch || fetch)(...a);

export async function keys() {
  const s = await settings();
  const sec = await secrets();
  if (!s.razorpay_key_id || !sec.razorpay_key_secret)
    throw new HttpError(503, "Payments aren't set up yet (admin › Settings › Razorpay).");
  return { id: s.razorpay_key_id, secret: sec.razorpay_key_secret, webhook: sec.razorpay_webhook_secret || "",
           test: s.razorpay_key_id.startsWith("rzp_test_") };
}

async function call(k, method, path, body) {
  const r = await go(`https://api.razorpay.com/v1/${path}`, {
    method,
    headers: { "content-type": "application/json",
               authorization: "Basic " + Buffer.from(`${k.id}:${k.secret}`).toString("base64") },
    body: body ? JSON.stringify(body) : undefined,
  });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new HttpError(502, "Razorpay: " + (d?.error?.description || `error ${r.status}`));
  return d;
}

/** a single-use UPI QR for exactly `amount` paise */
export const createQr = (k, { amount, code, closeBy, name, notes = {} }) => call(k, "POST", "payments/qr_codes", {
  type: "upi_qr", name: String(name || "Licence").slice(0, 40), usage: "single_use", fixed_amount: true,
  payment_amount: amount, description: `Licence ${code}`, close_by: closeBy, notes: { order_code: code, ...notes },
});

export const qrPayments = (k, qrId) => call(k, "GET", `payments/qr_codes/${encodeURIComponent(qrId)}/payments`);
export const payment = (k, id) => call(k, "GET", `payments/${encodeURIComponent(id)}`);
export const capture = (k, id, amount) => call(k, "POST", `payments/${encodeURIComponent(id)}/capture`, { amount, currency: "INR" });
export const listQrs = (k) => call(k, "GET", "payments/qr_codes?count=1");
export const closeQr = (k, qrId) => call(k, "POST", `payments/qr_codes/${encodeURIComponent(qrId)}/close`).catch(() => null);

export const hmac = (secret, data) => crypto.createHmac("sha256", secret).update(data).digest("hex");
export const sameHex = (a, b) => typeof a === "string" && typeof b === "string" && a.length === b.length &&
  crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));
