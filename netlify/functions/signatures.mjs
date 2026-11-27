// GET /api/signatures - threat fingerprints + blocked sites for every copy of SIM (SIM Shield updates).
// Published by the owner in Admin › Security or from SIM's quarantine ("share with all my copies").
import { db } from "./_lib/db.mjs";
import { handler, json } from "./_lib/http.mjs";

export default handler(async () => {
  let bad = {}, domains = [];
  try {
    const sigs = await db.select("security_signatures", {}, { limit: 50000, columns: "sha256,name" });
    bad = Object.fromEntries(sigs.map((s) => [s.sha256, s.name || "threat"]));
    domains = (await db.select("blocked_domains", {}, { limit: 50000, columns: "domain" })).map((d) => d.domain);
  } catch { /* schema not updated yet */ }
  return json({ bad, domains, count: Object.keys(bad).length }, 200, { "cache-control": "public, max-age=600" });
});

export const config = { path: "/api/signatures" };
