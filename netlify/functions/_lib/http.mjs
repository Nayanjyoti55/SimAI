// Small helpers shared by every server function.
export const json = (data, status = 200, extra = {}) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store", ...cors(), ...extra },
  });

export const cors = () => ({
  "access-control-allow-origin": "*",
  "access-control-allow-headers": "content-type, authorization, x-webhook-token",
  "access-control-allow-methods": "GET, POST, OPTIONS",
});

export const preflight = (req) => (req.method === "OPTIONS" ? new Response(null, { status: 204, headers: cors() }) : null);

export async function body(req) {
  try {
    const t = await req.text();
    if (!t) return {};
    try { return JSON.parse(t); } catch { return Object.fromEntries(new URLSearchParams(t)); }
  } catch { return {}; }
}

export const env = (k, d = "") => (globalThis.process?.env?.[k] ?? d);

export class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

// wrap a handler: OPTIONS, errors -> clean JSON
export const handler = (fn) => async (req, context) => {
  const pre = preflight(req);
  if (pre) return pre;
  try {
    return await fn(req, context);
  } catch (e) {
    if (e instanceof HttpError) return json({ error: e.message }, e.status);
    console.error(e);
    return json({ error: "Server error: " + (e?.message || e) }, 500);
  }
};
