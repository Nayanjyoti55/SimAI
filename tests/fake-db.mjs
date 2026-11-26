// In-memory stand-in for Supabase, enough for the server functions' tests.
import crypto from "node:crypto";

const DEFAULTS = {
  orders: () => ({ id: crypto.randomUUID(), status: "pending", kind: "new", method: "upi", created_at: new Date().toISOString(),
                   utr: null, licence_kid: null, renew_kid: null }),
  licences: () => ({ enabled: true, created_at: new Date().toISOString(), activated_machine: null, activated_at: null,
                     duration: 0, not_after: 0, machine: "" }),
  payment_events: () => ({ id: Math.floor(Math.random() * 1e9), received_at: new Date().toISOString() }),
  checkins: () => ({ id: Math.floor(Math.random() * 1e9), ts: new Date().toISOString() }),
  audit_log: () => ({ id: Math.floor(Math.random() * 1e9), at: new Date().toISOString() }),
};

function match(row, filters) {
  return Object.entries(filters).every(([k, v]) => {
    if (v && typeof v === "object" && v.__op) {
      const a = row[k], b = v.v;
      return { gt: a > b, gte: a >= b, lt: a < b, lte: a <= b, neq: a != b }[v.__op];
    }
    // eslint-disable-next-line eqeqeq
    return String(row[k]).toLowerCase() == String(v).toLowerCase() || row[k] === v;
  });
}

export function fakeDb(seed = {}) {
  const t = Object.fromEntries(Object.entries(seed).map(([k, v]) => [k, v.map((r) => ({ ...r }))]));
  const tab = (n) => (t[n] ||= []);
  return {
    tables: t,
    async select(table, filters = {}, { order, limit } = {}) {
      let rows = tab(table).filter((r) => match(r, filters));
      if (order) {
        const [col, dir] = order.split(".");
        rows = rows.sort((a, b) => (a[col] > b[col] ? 1 : -1) * (dir === "desc" ? -1 : 1));
      }
      return rows.slice(0, limit || rows.length).map((r) => ({ ...r }));
    },
    async insert(table, row) {
      const r = { ...(DEFAULTS[table]?.() || {}), ...row };
      tab(table).push(r);
      return { ...r };
    },
    async upsert(table, rows) { for (const r of rows) tab(table).push(r); return rows; },
    async update(table, filters, patch) {
      const hit = tab(table).filter((r) => match(r, filters));
      hit.forEach((r) => Object.assign(r, patch));
      return hit.map((r) => ({ ...r }));
    },
    async remove(table, filters) {
      const keep = tab(table).filter((r) => !match(r, filters));
      const gone = tab(table).length - keep.length;
      t[table] = keep;
      return gone;
    },
  };
}
