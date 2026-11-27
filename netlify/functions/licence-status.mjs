// POST /api/licence-status {key, machine?, device?, name?, platform?, activate?, installer?}
// Asked by the Windows INSTALLER, by every installed copy (every ~10 min) and by the Android app.
//   -> {"ok":true,...,"devices_used":1,"max_devices":2}
//   or {"ok":false,"reason":"invalid|unknown|disabled|expired|other_pc|device_limit|device_removed|renewed", message,...}
// (compact JSON on purpose: the installer looks for '"ok":true')
import { checkLicence, REASON_TEXT } from "./_lib/check.mjs";
import { failed, guard } from "./_lib/guard.mjs";
import { body, handler, HttpError, json } from "./_lib/http.mjs";

export default handler(async (req) => {
  if (req.method !== "POST") throw new HttpError(405, "POST only");
  await guard(req);
  const b = await body(req);
  const platform = b.platform === "android" ? "android" : "windows";
  const res = await checkLicence(b.key, { platform, device: b.device || b.machine, name: b.name || "",
                                          activate: !!b.activate, touch: !b.installer });
  if (!res.ok) {
    if (res.reason === "invalid" || res.reason === "unknown") await failed(req, "licence");   // key guessing
    const extra = {};
    for (const k of ["max_devices", "devices", "new_key", "kid", "until"]) if (res[k] !== undefined) extra[k] = res[k];
    return json({ ok: false, reason: res.reason, message: REASON_TEXT[res.reason] || "", ...extra });
  }
  return json({ ok: true, valid: res.valid, kid: res.kid, until: res.until || 0,
                devices_used: res.devices_used ?? null, max_devices: res.max_devices ?? null,
                ...(res.registered === false ? { registered: false } : {}) });
});

export const config = { path: "/api/licence-status" };
