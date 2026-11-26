// Supabase REST with the SERVICE ROLE key (server only - never sent to browsers).
import { env, HttpError } from "./http.mjs";

let impl = null; // tests swap the database for an in-memory one

export function setDb(fake) { impl = fake; }

function base() {
  const url = env("SUPABASE_URL").replace(/\/$/, "");
  const key = env("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !key) throw new HttpError(500, "The website isn't configured yet (SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY).");
  return { url, key };
}

async function rest(method, path, { query = {}, body, prefer = "" } = {}) {
  const { url, key } = base();
  const qs = new URLSearchParams(query).toString();
  const r = await fetch(`${url}/rest/v1/${path}${qs ? "?" + qs : ""}`, {
    method,
    headers: { apikey: key, authorization: `Bearer ${key}`, "content-type": "application/json",
               ...(prefer ? { prefer } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await r.text();
  if (!r.ok) throw new HttpError(502, `Database said ${r.status}: ${text.slice(0, 200)}`);
  return text ? JSON.parse(text) : null;
}

// filters: { col: value } -> col = value ;  { col: op("gt", x) } -> col > x
export const op = (o, v) => ({ __op: o, v });
const toQuery = (filters = {}) => Object.fromEntries(Object.entries(filters).map(([k, v]) =>
  [k, v && typeof v === "object" && v.__op ? `${v.__op}.${v.v}` : `eq.${v}`]));

export const db = {
  async select(table, filters = {}, { order, limit, columns = "*" } = {}) {
    if (impl) return impl.select(table, filters, { order, limit, columns });
    const q = { select: columns, ...toQuery(filters) };
    if (order) q.order = order;
    if (limit) q.limit = String(limit);
    return rest("GET", table, { query: q });
  },
  async one(table, filters = {}) {
    const rows = await db.select(table, filters, { limit: 1 });
    return rows?.[0] || null;
  },
  async insert(table, row) {
    if (impl) return impl.insert(table, row);
    const out = await rest("POST", table, { body: row, prefer: "return=representation" });
    return Array.isArray(out) ? out[0] : out;
  },
  async upsert(table, rows, onConflict) {
    if (impl) return impl.upsert(table, rows, onConflict);
    return rest("POST", table, { body: rows, query: onConflict ? { on_conflict: onConflict } : {},
                                 prefer: "resolution=merge-duplicates,return=representation" });
  },
  // returns the UPDATED rows - so "update ... where status = pending" doubles as a lock
  async update(table, filters, patch) {
    if (impl) return impl.update(table, filters, patch);
    return rest("PATCH", table, { query: toQuery(filters), body: patch, prefer: "return=representation" });
  },
  async remove(table, filters) {
    if (impl) return impl.remove(table, filters);
    return rest("DELETE", table, { query: toQuery(filters), prefer: "return=representation" });
  },
};

export async function settings() {
  return (await db.one("site_settings", { id: 1 })) || {};
}

export async function secrets() {
  return (await db.one("secret_settings", { id: 1 })) || {};
}

export async function audit(actor, action, details = {}) {
  try { await db.insert("audit_log", { actor, action, details }); } catch { /* never block the real work */ }
}
