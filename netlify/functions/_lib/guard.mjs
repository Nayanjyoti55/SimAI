// Website protection (v3.2): an address that keeps failing (wrong passwords, made-up licence keys, bad webhook
// signatures) is blocked for a while. Only FAILURES are counted, so normal use costs one quick lookup.
import { audit, db, op } from "./db.mjs";
import { HttpError } from "./http.mjs";

export const LIMITS = {          // failures per minute before a block, block length (minutes)
  login: [8, 30], licence: [20, 60], release: [10, 60], orders: [15, 30], ai: [30, 30], webhook: [20, 60],
};

export function clientIp(req) {
  const h = (k) => req.headers?.get?.(k) || "";
  return (h("x-nf-client-connection-ip") || h("cf-connecting-ip") || h("x-forwarded-for").split(",")[0] ||
          h("x-real-ip") || "").trim().slice(0, 64);
}

/** Throw 403 when this address is blocked. */
export async function guard(req) {
  const ip = clientIp(req);
  if (!ip) return "";
  try {
    const b = await db.one("blocked_ips", { ip });
    if (b && (!b.until || Date.parse(b.until) > Date.now())) {
      throw new HttpError(403, "Too many failed attempts from your network. Try again later.");
    }
  } catch (e) {
    if (e instanceof HttpError) throw e;           // the table missing (old schema) must never stop the site
  }
  return ip;
}

/** Count one failure; block the address when it crosses its limit. */
export async function failed(req, bucket) {
  const ip = clientIp(req);
  if (!ip) return;
  const [max, minutes] = LIMITS[bucket] || [20, 30];
  const minute = Math.floor(Date.now() / 60000);
  try {
    const row = await db.one("ip_hits", { ip, bucket, minute });
    const n = (row?.n || 0) + 1;
    await db.upsert("ip_hits", [{ ip, bucket, minute, n }], "ip,bucket,minute");
    if (n >= max) {
      const until = new Date(Date.now() + minutes * 60000).toISOString();
      await db.upsert("blocked_ips", [{ ip, reason: `${n} failed ${bucket} attempts in a minute`, until }], "ip");
      await audit("security", "ip_blocked", { ip, bucket, n });
    }
    if (Math.random() < 0.02) await db.remove("ip_hits", { minute: op("lt", minute - 60) });   // tidy old counters
  } catch { /* best effort */ }
}
