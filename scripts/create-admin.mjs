// npm run create-admin  -  makes (or repairs) the website's ADMIN account.
// Reads SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY from .env, then asks for username / e-mail / password.
// The password is typed here and sent straight to Supabase - it is never written to any file.
import fs from "node:fs";
import readline from "node:readline";

for (const line of (fs.existsSync(".env") ? fs.readFileSync(".env", "utf8") : "").split(/\r?\n/)) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
}
const URL_ = (process.env.SUPABASE_URL || "").replace(/\/$/, "");
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
if (!URL_ || !KEY) { console.error("Put SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env first (see README)."); process.exit(1); }

const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
const ask = (q, def = "") => new Promise((res) => rl.question(def ? `${q} [${def}]: ` : `${q}: `, (a) => res(a.trim() || def)));
const askHidden = (q) => new Promise((res) => {
  const out = rl.output; const orig = out.write.bind(out); let on = false;
  out.write = (s) => (on && !/\r?\n/.test(s) ? orig("*") : orig(s));
  rl.question(`${q}: `, (a) => { out.write = orig; res(a); });
  on = true;
});
const H = { apikey: KEY, authorization: `Bearer ${KEY}`, "content-type": "application/json" };

const username = await ask("Admin username", "Deadeye");
const email = await ask("Admin e-mail (used for password resets)");
const password = await askHidden("Admin password (min 8 characters)");
const again = await askHidden("Type the password again");
rl.close();
if (password.length < 8 || password !== again) { console.error("\nPasswords don't match or are too short."); process.exit(1); }

let r = await fetch(`${URL_}/auth/v1/admin/users`, {
  method: "POST", headers: H,
  body: JSON.stringify({ email, password, email_confirm: true, user_metadata: { username } }),
});
let user = await r.json();
if (!r.ok) {
  // already there -> find it and set the new password
  const list = await (await fetch(`${URL_}/auth/v1/admin/users?per_page=1000`, { headers: H })).json();
  user = (list.users || []).find((u) => (u.email || "").toLowerCase() === email.toLowerCase());
  if (!user) { console.error("\nSupabase said:", JSON.stringify(user || list).slice(0, 300)); process.exit(1); }
  await fetch(`${URL_}/auth/v1/admin/users/${user.id}`, { method: "PUT", headers: H, body: JSON.stringify({ password, email_confirm: true }) });
}
// free the username if someone else grabbed it, then make this account the admin
await fetch(`${URL_}/rest/v1/profiles?username=eq.${encodeURIComponent(username)}&id=neq.${user.id}`, {
  method: "PATCH", headers: H, body: JSON.stringify({ username: null }) });
r = await fetch(`${URL_}/rest/v1/profiles?on_conflict=id`, {
  method: "POST", headers: { ...H, prefer: "resolution=merge-duplicates" },
  body: JSON.stringify({ id: user.id, username, email, role: "admin", banned: false }) });
if (!r.ok) { console.error("\nCouldn't set the admin role:", await r.text()); process.exit(1); }
console.log(`\n✓ ${username} is the website admin. Sign in on the site with this username and password.`);
