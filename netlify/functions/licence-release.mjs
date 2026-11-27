// POST /api/licence-release {key, device, platform?}
// Frees one device slot of a key: "Sign out" in SIM, uninstalling SIM, or "Remove" in My licences.
import { failed, guard } from "./_lib/guard.mjs";
import { releaseDevice } from "./_lib/check.mjs";
import { body, handler, HttpError, json } from "./_lib/http.mjs";

export default handler(async (req) => {
  if (req.method !== "POST") throw new HttpError(405, "POST only");
  await guard(req);
  const b = await body(req);
  const platform = b.platform === "android" ? "android" : "windows";
  const res = await releaseDevice(b.key, b.device || b.machine, platform);
  if (!res.ok) await failed(req, "release");
  return json(res, res.ok ? 200 : 400);
});

export const config = { path: "/api/licence-release" };
