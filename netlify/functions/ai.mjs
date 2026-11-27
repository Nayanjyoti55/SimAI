// The shared AI brain: /api/ai/v1/chat/completions and /api/ai/v1/models (OpenAI-compatible).
// Installed copies and the Android app send their LICENCE KEY instead of an API key; this function checks the
// licence and forwards the request to Groq with YOUR key, which never leaves the server.
//   - a blocked, deleted or expired key stops getting answers at once
//   - each key has a daily limit (Admin > Settings), so one person can't use up everybody's quota
//   - message contents are passed through and never stored; only a per-key daily request count is kept
import { failed, guard } from "./_lib/guard.mjs";
import { checkLicence } from "./_lib/check.mjs";
import { db, secrets, settings } from "./_lib/db.mjs";
import { env, cors, handler, HttpError, json } from "./_lib/http.mjs";

const GROQ = "https://api.groq.com/openai/v1";
let fetchImpl = (...a) => fetch(...a);
export const setFetch = (f) => { fetchImpl = f; };

const SKIP = /whisper|guard|tts|orpheus|playai|compound|safeguard|distil|allam/i;
const PREF = ["openai/gpt-oss-120b", "openai/gpt-oss-20b", "llama-3.3-70b-versatile", "llama-3.1-8b-instant"];
const FAST = "llama-3.1-8b-instant";
const ALLOWED_FIELDS = ["model", "messages", "tools", "tool_choice", "temperature", "max_tokens", "stream", "top_p",
                        "reasoning_effort", "reasoning_format", "response_format", "stop"];
let modelCache = { t: 0, ids: [] };

async function groqKey() {
  const s = await secrets().catch(() => ({}));
  const k = s.groq_api_key || env("GROQ_API_KEY");
  if (!k) throw new HttpError(503, "The shared AI brain isn't set up on the website yet.");
  return k;
}

async function models(key) {
  if (Date.now() - modelCache.t < 6 * 3600e3 && modelCache.ids.length) return modelCache.ids;
  const r = await fetchImpl(`${GROQ}/models`, { headers: { authorization: `Bearer ${key}` } });
  if (!r.ok) return modelCache.ids;
  const ids = ((await r.json()).data || []).filter((m) => m.active !== false && !SKIP.test(m.id)).map((m) => m.id);
  modelCache = { t: Date.now(), ids };
  return ids;
}

async function who(req) {
  const auth = req.headers.get("authorization") || "";
  const key = auth.replace(/^Bearer\s+/i, "").trim();
  if (!key) throw new HttpError(401, "Send your licence key as the bearer token.");
  const platform = (req.headers.get("x-sim-platform") || "windows").toLowerCase() === "android" ? "android" : "windows";
  await guard(req);
  const res = await checkLicence(key, { platform, device: req.headers.get("x-sim-device") || "", touch: false });
  if (!res.ok) {
    if (res.reason === "invalid" || res.reason === "unknown") await failed(req, "ai");
    throw new HttpError(403, `licence ${res.reason}`);
  }
  return res;
}

async function countUse(kid, limit) {
  const day = new Date().toISOString().slice(0, 10);
  const row = await db.one("ai_usage", { kid, day });
  const n = (row?.requests || 0) + 1;
  if (limit && n > limit) throw new HttpError(429, `Daily AI limit reached for this licence (${limit}). It resets at midnight UTC.`);
  if (row) await db.update("ai_usage", { kid, day }, { requests: n, last_at: new Date().toISOString() });
  else await db.insert("ai_usage", { kid, day, requests: 1, last_at: new Date().toISOString() });
}

export default handler(async (req) => {
  const path = new URL(req.url).pathname.replace(/\/+$/, "");
  const s = await settings();
  if (s.ai_enabled === false) throw new HttpError(503, "The shared AI brain is switched off by the admin.");
  const lic = await who(req);
  const key = await groqKey();
  if (path.endsWith("/models")) {
    const ids = await models(key);
    return json({ object: "list", data: ids.map((id) => ({ id, object: "model", owned_by: "groq" })) });
  }
  if (path.endsWith("/audio/transcriptions") && req.method === "POST") {
    // the phone's voice commands (recorded after "Hey SIM") -> text, with Groq's Whisper
    await countUse(lic.kid, Number(s.ai_daily_limit ?? 300));
    let form;
    try { form = await req.formData(); } catch { throw new HttpError(400, "Send the audio as multipart form data."); }
    const file = form.get("file");
    if (!file || typeof file === "string") throw new HttpError(400, "file missing");
    if (file.size > 4 * 1024 * 1024) throw new HttpError(413, "Recording too long.");
    const fd = new FormData();
    fd.append("file", file, file.name || "speech.wav");
    fd.append("model", "whisper-large-v3-turbo");
    fd.append("response_format", "json");
    if (form.get("language")) fd.append("language", String(form.get("language")));
    if (form.get("prompt")) fd.append("prompt", String(form.get("prompt")).slice(0, 200));
    const up = await fetchImpl(`${GROQ}/audio/transcriptions`, { method: "POST", headers: { authorization: `Bearer ${key}` }, body: fd });
    return new Response(up.body, { status: up.status, headers: { ...cors(), "content-type": "application/json", "cache-control": "no-store" } });
  }
  if (!path.endsWith("/chat/completions") || req.method !== "POST") throw new HttpError(404, "Unknown AI endpoint.");
  let b;
  try { b = JSON.parse(await req.text()); } catch { throw new HttpError(400, "Bad JSON."); }
  if (!Array.isArray(b.messages) || !b.messages.length) throw new HttpError(400, "messages missing");
  await countUse(lic.kid, Number(s.ai_daily_limit ?? 300));
  const out = Object.fromEntries(ALLOWED_FIELDS.filter((k) => b[k] !== undefined).map((k) => [k, b[k]]));
  out.max_tokens = Math.min(Number(out.max_tokens) || 1024, 4096);
  const ids = await models(key);
  if (!out.model || (ids.length && !ids.includes(out.model)))
    out.model = (s.ai_model && (!ids.length || ids.includes(s.ai_model)) ? s.ai_model : PREF.find((m) => ids.includes(m)) || ids[0]) || FAST;
  if (/gpt-oss/.test(out.model) && !out.reasoning_effort) out.reasoning_effort = "low";
  const send = (body) => fetchImpl(`${GROQ}/chat/completions`, {
    method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${key}` }, body: JSON.stringify(body),
  });
  let up = await send(out);
  if (up.status === 429 && out.model !== FAST && ids.includes(FAST)) {   // the big model is busy: the fast one answers
    const { reasoning_effort, ...rest } = out;
    void reasoning_effort;
    up = await send({ ...rest, model: FAST });
  }
  const headers = { ...cors(), "cache-control": "no-store",
                    "content-type": up.headers.get("content-type") || (out.stream ? "text/event-stream" : "application/json") };
  const ra = up.headers.get("retry-after");
  if (ra) headers["retry-after"] = ra;
  // streamed answers go straight through, word by word
  return new Response(up.body, { status: up.status, headers });
});

export const config = { path: ["/api/ai/v1/models", "/api/ai/v1/chat/completions", "/api/ai/v1/audio/transcriptions"] };
