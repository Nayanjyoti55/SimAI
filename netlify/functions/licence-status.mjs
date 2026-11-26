// POST /api/licence-status {key, machine?, device?, platform?, activate?, installer?}
// Asked by the Windows INSTALLER, by every installed copy (every ~10 min) and by the Android app.
//   -> {"ok":true,...}  or  {"ok":false,"reason":"invalid|unknown|disabled|expired|other_pc|used|used_phone"}
// (compact JSON on purpose: the installer looks for '"ok":true')
import { checkLicence } from "./_lib/check.mjs";
import { body, handler, HttpError, json } from "./_lib/http.mjs";

export default handler(async (req) => {
  if (req.method !== "POST") throw new HttpError(405, "POST only");
  const b = await body(req);
  const platform = b.platform === "android" ? "android" : "windows";
  const res = await checkLicence(b.key, { platform, device: b.device || b.machine, activate: !!b.activate,
                                          touch: !b.installer });
  if (!res.ok) return json({ ok: false, reason: res.reason });
  return json({ ok: true, valid: res.valid, kid: res.kid, until: res.until || 0,
                ...(res.registered === false ? { registered: false } : {}) });
});

export const config = { path: "/api/licence-status" };
