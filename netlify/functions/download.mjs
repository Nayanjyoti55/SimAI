// GET /api/download[?id=N | ?platform=android] - the newest Windows installer (or Android app), counts the download,
// then sends the file. No sign-in needed.
import { db } from "./_lib/db.mjs";
import { handler, json } from "./_lib/http.mjs";

export default handler(async (req) => {
  const q = new URL(req.url).searchParams;
  const id = q.get("id");
  const platform = q.get("platform") === "android" ? "android" : "windows";
  const rows = id ? await db.select("releases", { id, published: true }, { limit: 1 })
    : await db.select("releases", { published: true, platform }, { order: "created_at.desc", limit: 1 });
  const rel = rows?.[0];
  if (!rel) return json({ error: platform === "android" ? "The Android app hasn't been published yet." : "No installer has been published yet." }, 404);
  try { await db.update("releases", { id: rel.id }, { downloads: (rel.downloads || 0) + 1 }); } catch { /* ignore */ }
  return new Response(null, { status: 302, headers: { location: rel.url, "cache-control": "no-store" } });
});

export const config = { path: "/api/download" };
