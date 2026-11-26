// Talking to the website's server functions and to Supabase (sign-in, your licences, the admin tables).
//
// Why the site used to "get stuck until refresh": supabase-js runs onAuthStateChange callbacks while it holds
// its auth lock. Our callback awaited a database query, and that query needs the same lock -> it waited for
// itself forever. Now the callback only schedules the work (setTimeout), and every network step has a time limit.

export const state = { cfg: null, sb: null, session: null, profile: null };

/** reject if `p` takes longer than `ms` */
export function timeout(p, ms, what = "The server") {
  let t;
  return Promise.race([p, new Promise((_, rej) => { t = setTimeout(() => rej(new Error(`${what} took too long to answer.`)), ms); })])
    .finally(() => clearTimeout(t));
}

async function loadSupabase() {
  const urls = ["https://esm.sh/@supabase/supabase-js@2.45.4", "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/+esm"];
  let last;
  for (const u of urls) {
    try { return await timeout(import(u), 10000, "Loading the sign-in library"); } catch (e) { last = e; }
  }
  throw last;
}

async function getConfig() {
  let last;
  for (let i = 0; i < 3; i++) {
    try {
      const r = await timeout(fetch("/api/config", { cache: "no-store" }), 8000);
      if (r.ok) return await r.json();
      last = new Error(`The server answered ${r.status}.`);
    } catch (e) { last = e; }
    await new Promise((res) => setTimeout(res, 600 * (i + 1)));
  }
  throw last;
}

export async function boot() {
  const [cfg, lib] = await Promise.all([getConfig(), loadSupabase()]);
  state.cfg = cfg;
  if (!cfg.supabase_url) throw new Error("The website isn't connected to its database yet (see README, step 3).");
  state.sb = lib.createClient(cfg.supabase_url, cfg.supabase_anon_key, {
    auth: { flowType: "pkce", persistSession: true, detectSessionInUrl: true, autoRefreshToken: true },
  });
  try {
    const { data } = await timeout(state.sb.auth.getSession(), 8000, "Sign-in");
    state.session = data.session;
  } catch { state.session = null; }
  await loadProfile();
  state.sb.auth.onAuthStateChange((event, session) => {
    state.session = session;
    // never await Supabase inside this callback (that was the freeze) - do it right after
    setTimeout(async () => {
      if (event !== "TOKEN_REFRESHED") await loadProfile();
      document.dispatchEvent(new CustomEvent("auth-changed", { detail: event }));
    }, 0);
  });
  return state.cfg;
}

export async function loadProfile() {
  if (!state.session) { state.profile = null; return null; }
  try {
    const { data } = await timeout(state.sb.from("profiles").select("*").eq("id", state.session.user.id).maybeSingle(), 8000);
    state.profile = data;
  } catch (e) { console.warn("profile:", e.message); }
  return state.profile;
}

export const isAdmin = () => state.profile?.role === "admin";

/** fetch one of our /api functions, signed in when possible */
export async function api(path, { method = "GET", body } = {}) {
  const headers = { "content-type": "application/json" };
  if (state.session?.access_token) headers.authorization = `Bearer ${state.session.access_token}`;
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 25000);
  let r;
  try { r = await fetch(path, { method, headers, signal: ctl.signal, body: body === undefined ? undefined : JSON.stringify(body) }); }
  catch (e) { throw new Error(e.name === "AbortError" ? "The server took too long to answer. Please try again." : "No connection to the website. Check your internet."); }
  finally { clearTimeout(timer); }
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(data.error || `Request failed (${r.status})`);
  return data;
}

export async function signInWithUsername(username, password) {
  const d = await api("/api/login", { method: "POST", body: { username, password } });
  const { error } = await state.sb.auth.setSession({ access_token: d.access_token, refresh_token: d.refresh_token });
  if (error) throw error;
  state.session = (await timeout(state.sb.auth.getSession(), 8000, "Sign-in")).data.session;
  await loadProfile();
  return d;
}

export async function signInWithGoogle(next = "#/account") {
  sessionStorage.setItem("after_login", next);
  const { error } = await state.sb.auth.signInWithOAuth({
    provider: "google", options: { redirectTo: `${location.origin}/` },
  });
  if (error) throw error;
}

export async function signOut() {
  await timeout(state.sb.auth.signOut(), 6000).catch(() => {});
  state.session = null;
  state.profile = null;
}

// ---------------------------------------------------------------- formatting
export const rupees = (paise) => "₹" + (Number(paise || 0) / 100).toLocaleString("en-IN", {
  minimumFractionDigits: paise % 100 ? 2 : 0, maximumFractionDigits: 2 });
export const exactRupees = (paise) => "₹" + (Number(paise || 0) / 100).toFixed(2);
export const when = (iso) => iso ? new Date(iso).toLocaleString("en-IN", { day: "2-digit", month: "short",
  year: "numeric", hour: "2-digit", minute: "2-digit" }) : "—";
export const day = (iso) => iso ? new Date(iso).toLocaleDateString("en-IN", { day: "2-digit", month: "short",
  year: "numeric" }) : "—";
export const until = (unix) => (Number(unix) ? day(new Date(Number(unix) * 1000).toISOString()) : "Never expires");
export const size = (b) => !b ? "" : b > 1048576 ? `${(b / 1048576).toFixed(1)} MB` : `${Math.round(b / 1024)} KB`;
export const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;",
  '"': "&quot;", "'": "&#39;" }[c]));
