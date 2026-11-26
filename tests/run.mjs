// node tests/run.mjs - checks the money path end to end with an in-memory database and a pretend Razorpay:
// buy -> the order's own UPI QR -> Razorpay confirms the payment -> order paid -> licence key -> installer check.
// The rule under test: NO key unless Razorpay itself reports a captured payment, for this QR, for exactly this amount.
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { setFakeUser } from "../netlify/functions/_lib/auth.mjs";
import { setDb } from "../netlify/functions/_lib/db.mjs";
import { readKey } from "../netlify/functions/_lib/licence.mjs";
import { setFetch } from "../netlify/functions/_lib/razorpay.mjs";
import { setFetch as setAiFetch } from "../netlify/functions/ai.mjs";
import { fakeDb } from "./fake-db.mjs";

process.env.LICENCE_SIGNING_KEY = crypto.randomBytes(32).toString("hex");
process.env.SUPABASE_URL = "https://example.supabase.co";

// ---------------------------------------------------------------- pretend Razorpay
const RZP = { qrs: {}, payments: [], calls: [] };
const KEY_ID = "rzp_test_abc123", KEY_SECRET = "test-secret-xyz", HOOK_SECRET = "hook-secret-777";
setFetch(async (url, opt = {}) => {
  const path = url.replace("https://api.razorpay.com/v1/", "");
  RZP.calls.push(`${opt.method} ${path}`);
  const ok = (d) => new Response(JSON.stringify(d), { status: 200 });
  const auth = Buffer.from(opt.headers.authorization.replace("Basic ", ""), "base64").toString();
  if (auth !== `${KEY_ID}:${KEY_SECRET}`) return new Response(JSON.stringify({ error: { description: "Authentication failed" } }), { status: 401 });
  const body = opt.body ? JSON.parse(opt.body) : {};
  let m;
  if (opt.method === "POST" && path === "payments/qr_codes") {
    assert.equal(body.usage, "single_use"); assert.equal(body.fixed_amount, true); assert.equal(body.type, "upi_qr");
    assert.ok(body.close_by > Date.now() / 1000 + 120, "Razorpay needs close_by at least 2 minutes ahead");
    const id = "qr_" + crypto.randomBytes(5).toString("hex");
    RZP.qrs[id] = { id, status: "active", payment_amount: body.payment_amount, notes: body.notes,
                    image_url: `https://rzp.io/i/${id}`, image_content: `upi://pay?pa=rzp.test@icici&pn=SIM&tr=${id}&am=${body.payment_amount / 100}&cu=INR&mc=5411` };
    return ok(RZP.qrs[id]);
  }
  if ((m = path.match(/^payments\/qr_codes\/(qr_\w+)\/payments$/))) return ok({ entity: "collection", items: RZP.payments.filter((p) => p.qr === m[1]) });
  if ((m = path.match(/^payments\/qr_codes\/(qr_\w+)\/close$/))) { RZP.qrs[m[1]].status = "closed"; return ok(RZP.qrs[m[1]]); }
  if (path.startsWith("payments/qr_codes?")) return ok({ items: Object.values(RZP.qrs).slice(0, 1) });
  if ((m = path.match(/^payments\/(pay_\w+)\/capture$/))) {
    const p = RZP.payments.find((x) => x.id === m[1]);
    assert.equal(body.amount, p.amount);
    p.status = "captured";
    return ok(p);
  }
  return new Response("{}", { status: 404 });
});
let payN = 0;
const customerPays = (qr, amount, { status = "captured", rrn = String(400000000000 + ++payN), vpa = "rahul.k@okaxis", id } = {}) => {
  const p = { id: id || `pay_${crypto.randomBytes(5).toString("hex")}`, qr, amount, currency: "INR", status, method: "upi", vpa,
              acquirer_data: { rrn }, notes: { qr_code_id: qr } };
  RZP.payments.push(p);
  return p;
};

// ---------------------------------------------------------------- database + people
const buyer = { id: "u-1", username: "rahul", email: "rahul@example.com", role: "user", banned: false };
const other = { id: "u-2", username: "ananya", email: "a@example.com", role: "user", banned: false };
const admin = { id: "u-0", username: "Deadeye", email: "owner@example.com", role: "admin", banned: false };
const D = fakeDb({
  profiles: [buyer, other, admin],
  plans: [{ id: "month", name: "1 month", duration_days: 30, price_paise: 9900, active: true },
          { id: "lifetime", name: "Lifetime", duration_days: 0, price_paise: 199900, active: true }],
  site_settings: [{ id: 1, product_name: "S.I.M", payments_enabled: true, razorpay_key_id: "", payment_window_min: 15,
                    auto_issue: true, installer_check: true, one_pc_per_key: true }],
  secret_settings: [{ id: 1, razorpay_key_secret: "", razorpay_webhook_secret: "" }],
});
setDb(D);
setFakeUser((tok) => ({ user: { id: tok }, profile: { "u-0": admin, "u-1": buyer, "u-2": other }[tok] }));

const call = async (mod, { method = "POST", body, token, path = "/", params, headers = {}, raw } = {}) => {
  const { default: h } = await import(`../netlify/functions/${mod}.mjs`);
  const req = new Request("http://localhost" + path, {
    method, body: raw ?? (body ? JSON.stringify(body) : undefined),
    headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}), ...headers },
  });
  const res = await h(req, { params: params || {} });
  return { status: res.status, data: res.status === 302 ? res.headers.get("location") : await res.json() };
};
const look = (id, token = "u-1") => call("order-get", { method: "GET", token, params: { id } });
const hook = (payload, secret = HOOK_SECRET) => {
  const raw = JSON.stringify(payload);
  return call("razorpay-webhook", { raw, headers: { "x-razorpay-signature": crypto.createHmac("sha256", secret).update(raw).digest("hex") } });
};
const row = (id) => D.tables.orders.find((o) => o.id === id);
const keysFor = (id) => D.tables.licences.filter((l) => l.order_id === id);

// 1. before Razorpay is set up, nobody can start a payment (and the site says so)
let r = await call("orders-create", { body: { plan_id: "month" }, token: "u-1" });
assert.equal(r.status, 503);
r = await call("config", { method: "GET" });
assert.equal(r.data.payments_ready, false);
D.tables.site_settings[0].razorpay_key_id = KEY_ID;
D.tables.secret_settings[0].razorpay_key_secret = KEY_SECRET;
D.tables.secret_settings[0].razorpay_webhook_secret = HOOK_SECRET;
r = await call("config", { method: "GET" });
assert.equal(r.data.payments_ready, true); assert.equal(r.data.test_mode, true);
assert.equal(r.data.db_ready, true); assert.equal(r.data.schema_latest, undefined);   // the quick check stays quick
r = await call("config", { method: "GET", path: "/api/config?check=1" });             // SIM's LICENSES checklist
assert.equal(r.data.schema_latest, true); assert.equal(r.data.webhook_ready, true);
assert.ok(Array.isArray(r.data.env_missing) && !JSON.stringify(r.data).includes(KEY_SECRET));
console.log("1> no Razorpay keys -> no payments; keys added -> ready (test mode); setup check reports, never leaks");

// 2. an order gets its own single-use QR for exactly the plan price; asking again returns the same one
r = await call("orders-create", { body: { plan_id: "month" }, token: "u-1" });
assert.equal(r.status, 200, JSON.stringify(r.data));
const o1 = r.data.order;
assert.ok(o1.upi_link.startsWith("upi://pay?") && o1.qr_image && o1.amount_paise === 9900);
const qr1 = row(o1.id).rzp_qr_id;
assert.equal(RZP.qrs[qr1].payment_amount, 9900);
r = await call("orders-create", { body: { plan_id: "month" }, token: "u-1" });
assert.equal(r.data.order.id, o1.id);
r = await call("orders-create", { body: { plan_id: "month" }, token: "u-2" });
const o2 = r.data.order;
assert.notEqual(row(o2.id).rzp_qr_id, qr1, "every buyer has a different QR");
console.log(`2> order ${o1.code}: own QR ${qr1} for exactly ₹99.00`);

// 3. nothing paid / wrong amount / failed / someone else's QR -> NO key
r = await look(o1.id);
assert.equal(r.data.order.status, "pending"); assert.equal(r.data.licence, null);
customerPays(qr1, 9800);                                     // short by ₹1
customerPays(qr1, 9900, { status: "failed" });               // bank declined
customerPays(row(o2.id).rzp_qr_id, 9900, { status: "created" });  // other buyer's QR, not finished
r = await look(o1.id);
assert.equal(r.data.order.status, "pending");
assert.equal((D.tables.licences || []).length, 0, "no key without a real captured payment");
r = await look(o1.id, "u-2");
assert.equal(r.status, 404, "nobody can look at someone else's order");
console.log("3> unpaid, ₹1 short, failed and unfinished payments -> no key");

// 4. the real payment arrives -> the next check (every 3 s on the page) gives the key
const p1 = customerPays(qr1, 9900, { status: "authorized", rrn: "432198765432" });   // held -> the server captures it
const t0 = Date.now();
r = await look(o1.id);
assert.equal(r.data.order.status, "paid", JSON.stringify(r.data));
assert.equal(RZP.payments.find((p) => p.id === p1.id).status, "captured");
const lic = D.tables.licences.find((l) => l.kid === r.data.order.licence_kid);
assert.ok(lic && lic.enabled && lic.user_id === "u-1" && readKey(lic.key).info.kid === lic.kid);
assert.equal(r.data.licence.key, lic.key);
assert.equal(row(o1.id).utr, "432198765432"); assert.equal(row(o1.id).razorpay_payment_id, p1.id);
console.log(`4> Razorpay says captured -> paid, licence ${lic.kid} in ${Date.now() - t0} ms (UPI ref ${row(o1.id).utr})`);

// 5. the webhook for the same payment + more page checks -> still exactly one key
r = await hook({ event: "qr_code.credited", payload: { qr_code: { entity: { id: qr1 } }, payment: { entity: p1 } } });
assert.equal(r.status, 200);
await look(o1.id); await look(o1.id);
assert.equal(keysFor(o1.id).length, 1);
console.log("5> webhook + repeated checks for one payment -> one key");

// 6. webhooks: bad signature refused; good one gives buyer 2 their key instantly; unknown QR ignored
const p2 = customerPays(row(o2.id).rzp_qr_id, 9900);
r = await hook({ event: "qr_code.credited", payload: { qr_code: { entity: { id: row(o2.id).rzp_qr_id } } } }, "wrong-secret");
assert.equal(r.status, 401);
assert.equal(row(o2.id).status, "pending");
r = await hook({ event: "qr_code.credited", payload: { qr_code: { entity: { id: row(o2.id).rzp_qr_id } }, payment: { entity: p2 } } });
assert.equal(r.data.issued, true);
assert.equal(row(o2.id).status, "paid");
r = await hook({ event: "qr_code.credited", payload: { qr_code: { entity: { id: "qr_someoneelse" } } } });
assert.ok(r.data.ignored);
console.log("6> forged webhook refused; signed webhook -> key at once; unknown QR ignored");

// 7. a payment id can never complete two orders (even if Razorpay data were mixed up)
r = await call("orders-create", { body: { plan_id: "lifetime" }, token: "u-2" });
const o3 = r.data.order;
customerPays(row(o3.id).rzp_qr_id, 199900, { id: p2.id });
r = await look(o3.id, "u-2");
assert.equal(r.data.order.status, "pending");
console.log("7> re-used payment id -> refused");

// 8. paid just as the QR expired -> still counts; expired and unpaid -> stays expired
row(o3.id).status = "expired";
r = await hook({ event: "qr_code.credited", payload: { qr_code: { entity: { id: row(o3.id).rzp_qr_id } } } });
assert.equal(row(o3.id).status, "expired", "no payment -> back to expired");
customerPays(row(o3.id).rzp_qr_id, 199900);
r = await hook({ event: "payment.captured", payload: { payment: { entity: { notes: { qr_code_id: row(o3.id).rzp_qr_id } } } } });
assert.equal(row(o3.id).status, "paid");
assert.equal(keysFor(o3.id)[0].not_after, 0, "lifetime key");
console.log("8> late payment on an expired QR still gives the key; unpaid expired order stays closed");

// 9. cancel: closes the QR; but if the money arrived a moment ago, the order is paid instead
r = await call("orders-create", { body: { plan_id: "month" }, token: "u-1" });
const o4 = r.data.order;
r = await call("order-get", { token: "u-1", params: { id: o4.id }, body: { action: "cancel" } });
assert.equal(r.data.order.status, "cancelled");
assert.equal(RZP.qrs[row(o4.id).rzp_qr_id].status, "closed");
r = await call("orders-create", { body: { plan_id: "month" }, token: "u-1" });
const o5 = r.data.order;
customerPays(row(o5.id).rzp_qr_id, 9900);
r = await call("order-get", { token: "u-1", params: { id: o5.id }, body: { action: "cancel" } });
assert.equal(r.data.order.status, "paid");
console.log("9> cancel closes the QR; cancelling right after paying -> paid, not cancelled");

// 10. installer check + app activation + one PC per key + block + check-in
r = await call("licence-status", { body: { key: lic.key, installer: true } });
assert.equal(r.data.ok, true);
r = await call("licence-status", { body: { key: lic.key, machine: "7K2Q-9XWM-4TPA-B", activate: true } });
assert.equal(r.data.ok, true);
r = await call("licence-status", { body: { key: lic.key, machine: "AAAA-BBBB-CCCC-D", activate: true } });
assert.equal(r.data.reason, "used");
r = await call("licence-status", { body: { key: lic.key.replace(/^./, (c) => (c === "7" ? "8" : "7")) } });
assert.equal(r.data.reason, "invalid");
lic.enabled = false;
r = await call("licence-status", { body: { key: lic.key } });
assert.equal(r.data.reason, "disabled");
lic.enabled = true;
r = await call("checkin", { body: { kid: lic.kid, machine: "7K2Q9XWM4TPAB", app_version: "3.10", ai_name: "Nova",
                                    os: "Windows 11", unlock_fails: 2, status: "ok" } });
assert.equal(r.data.ok, true);
console.log("10> installer check, one PC per key, tampered + blocked keys refused, check-in stored");

// 11. admin tools; a buyer can't use them
r = await call("admin", { body: {}, token: "u-1", params: { action: "stats" } });
assert.equal(r.status, 403);
r = await call("admin", { body: {}, token: "u-0", params: { action: "test-razorpay" } });
assert.equal(r.data.ok, true);
r = await call("admin", { body: { generate_webhook_secret: true }, token: "u-0", params: { action: "secrets-set" } });
assert.ok(r.data.generated_webhook_secret.length >= 20 && D.tables.secret_settings[0].razorpay_webhook_secret === r.data.generated_webhook_secret);
r = await call("orders-create", { body: { plan_id: "month" }, token: "u-2" });
const o6 = r.data.order;
r = await call("admin", { body: { order_id: o6.id }, token: "u-0", params: { action: "recheck" } });
assert.equal(r.data.status, "pending");
customerPays(row(o6.id).rzp_qr_id, 9900);
r = await call("admin", { body: { order_id: o6.id }, token: "u-0", params: { action: "recheck" } });
assert.equal(r.data.status, "paid");
r = await call("admin", { body: { for_whom: "Arjun", days: 7, start: "now" }, token: "u-0", params: { action: "issue-key" } });
assert.ok(r.data.key && r.data.licence.valid.startsWith("until"));
r = await call("admin", { body: {}, token: "u-0", params: { action: "stats" } });
assert.equal(r.data.orders_paid, 5);
console.log("11> admin: key test, webhook secret, re-check payment, hand-made key, stats; buyers locked out");

// 12. renewal continues from the old end date; the old key is switched off
r = await call("orders-create", { body: { plan_id: "month", renew_kid: lic.kid }, token: "u-1" });
const o7 = r.data.order;
customerPays(row(o7.id).rzp_qr_id, 9900);
await look(o7.id);
const newer = keysFor(o7.id)[0];
assert.ok(newer.not_after >= lic.not_after + 30 * 86400 - 5 && !lic.enabled && lic.renewed_to === newer.kid);
console.log("12> renewal runs on from the old end date");

// 13. wrong Razorpay secret -> clear error, no order left hanging
D.tables.secret_settings[0].razorpay_key_secret = "typo";
r = await call("orders-create", { body: { plan_id: "lifetime" }, token: "u-1" });
assert.equal(r.status, 502);
assert.ok(/Razorpay/.test(r.data.error));
assert.equal(D.tables.orders.filter((o) => o.status === "pending" && o.plan_id === "lifetime" && o.user_id === "u-1").length, 0);
console.log(`13> wrong secret -> "${r.data.error}", no half-made order`);

// 14. one key = one PC + one phone; a second phone is refused; admin can free the phone
D.tables.secret_settings[0].razorpay_key_secret = KEY_SECRET;
const k2 = newer;                                           // the renewed key from step 12
r = await call("licence-status", { body: { key: k2.key, platform: "android", device: "a1b2-c3d4-e5f6", activate: true } });
assert.equal(r.data.ok, true, JSON.stringify(r.data));
assert.ok(r.data.until > Date.now() / 1000, "the phone is told when the key ends");
assert.equal(k2.activated_phone, "A1B2C3D4E5F6");
r = await call("licence-status", { body: { key: k2.key, machine: "PCPC-PCPC-PCPC-P", activate: true } });
assert.equal(r.data.ok, true, "the same key still works on a PC");
r = await call("licence-status", { body: { key: k2.key, platform: "android", device: "other-phone", activate: true } });
assert.equal(r.data.reason, "used_phone");
r = await call("admin", { body: { kid: k2.kid }, token: "u-0", params: { action: "reset-phone" } });
r = await call("licence-status", { body: { key: k2.key, platform: "android", device: "other-phone", activate: true } });
assert.equal(r.data.ok, true);
console.log("14> one key works on 1 PC + 1 phone; a 2nd phone is refused until the admin frees it");

// 15. the shared AI brain: licence key instead of an API key; Groq key never leaves the server
const GROQ_CALLS = [];
setAiFetch(async (url, opt = {}) => {
  GROQ_CALLS.push({ url, opt });
  assert.equal(opt.headers.authorization, "Bearer gsk_owner_test_key", "the server's own Groq key is used");
  if (url.endsWith("/models")) return new Response(JSON.stringify({ data: [{ id: "openai/gpt-oss-120b" }, { id: "llama-3.1-8b-instant" }, { id: "whisper-large-v3" }] }));
  if (url.endsWith("/audio/transcriptions")) {
    assert.equal(opt.body.get("model"), "whisper-large-v3-turbo");
    return new Response(JSON.stringify({ text: `heard ${opt.body.get("file").size} bytes` }));
  }
  const body = JSON.parse(opt.body);
  if (body.stream) return new Response("data: {\"choices\":[{\"delta\":{\"content\":\"Hi\"}}]}\n\ndata: [DONE]\n\n", { headers: { "content-type": "text/event-stream" } });
  return new Response(JSON.stringify({ choices: [{ message: { role: "assistant", content: `ok ${body.model} ${body.max_tokens}` }, finish_reason: "stop" }] }), { headers: { "content-type": "application/json" } });
});
const ai = (path, { key, bodyObj, method = "POST", platform = "windows", device = "" } = {}) =>
  call("ai", { method, path, raw: bodyObj ? JSON.stringify(bodyObj) : undefined,
               headers: { ...(key ? { authorization: `Bearer ${key}` } : {}), "x-sim-platform": platform, "x-sim-device": device } });
r = await ai("/api/ai/v1/chat/completions", { key: k2.key, bodyObj: { messages: [{ role: "user", content: "hi" }] } });
assert.equal(r.status, 503, "no Groq key on the server yet");
D.tables.secret_settings[0].groq_api_key = "gsk_owner_test_key";
r = await ai("/api/ai/v1/chat/completions", { bodyObj: { messages: [{ role: "user", content: "hi" }] } });
assert.equal(r.status, 401);
r = await ai("/api/ai/v1/chat/completions", { key: "NOT-A-REAL-KEY", bodyObj: { messages: [{ role: "user", content: "hi" }] } });
assert.equal(r.status, 403);
r = await ai("/api/ai/v1/models", { key: k2.key, method: "GET" });
assert.deepEqual(r.data.data.map((m) => m.id), ["openai/gpt-oss-120b", "llama-3.1-8b-instant"], "speech models hidden");
r = await ai("/api/ai/v1/chat/completions", { key: k2.key, bodyObj: { model: "made-up", max_tokens: 99999, messages: [{ role: "user", content: "hi" }], secret_field: 1 } });
assert.equal(r.status, 200);
assert.equal(r.data.choices[0].message.content, "ok openai/gpt-oss-120b 4096", "unknown model replaced, tokens capped");
assert.equal(JSON.parse(GROQ_CALLS.at(-1).opt.body).reasoning_effort, "low", "reasoning kept short");
const fd = new FormData();
fd.append("file", new Blob([new Uint8Array(3200)], { type: "audio/wav" }), "cmd.wav");
const tr = await (await import("../netlify/functions/ai.mjs")).default(new Request("http://localhost/api/ai/v1/audio/transcriptions", {
  method: "POST", headers: { authorization: `Bearer ${k2.key}` }, body: fd }), {});
assert.equal((await tr.json()).text, "heard 3200 bytes", "voice commands from the phone are transcribed");
assert.ok(!JSON.parse(GROQ_CALLS.filter((c) => c.url.endsWith("/chat/completions")).at(-1).opt.body).secret_field, "only known fields are forwarded");
const resp = await (await import("../netlify/functions/ai.mjs")).default(new Request("http://localhost/api/ai/v1/chat/completions", {
  method: "POST", headers: { authorization: `Bearer ${k2.key}` }, body: JSON.stringify({ stream: true, messages: [{ role: "user", content: "hi" }] }) }), {});
assert.equal(resp.headers.get("content-type"), "text/event-stream");
assert.ok((await resp.text()).includes("[DONE]"), "streamed answers pass straight through");
r = await ai("/api/ai/v1/chat/completions", { key: k2.key, platform: "android", device: "third-phone", bodyObj: { messages: [{ role: "user", content: "hi" }] } });
assert.equal(r.status, 403, "a phone that isn't the key's phone can't use the brain");
D.tables.site_settings[0].ai_daily_limit = 2;              // 2 questions already asked today
r = await ai("/api/ai/v1/chat/completions", { key: k2.key, bodyObj: { messages: [{ role: "user", content: "hi" }] } });
assert.equal(r.status, 429, "daily limit per licence");
k2.enabled = false;
D.tables.site_settings[0].ai_daily_limit = 300;
r = await ai("/api/ai/v1/chat/completions", { key: k2.key, bodyObj: { messages: [{ role: "user", content: "hi" }] } });
assert.equal(r.status, 403, "a switched-off key loses the brain at once");
k2.enabled = true;
assert.ok(!JSON.stringify(D.tables.ai_usage).includes("hi"), "message contents are never stored");
console.log(`15> shared AI brain: licence-checked, Groq key stays server-side, limits + blocking work (${D.tables.ai_usage[0].requests} requests counted)`);

console.log(`\nWEBSITE SERVER TESTS PASSED (${RZP.calls.length} pretend Razorpay calls)`);
