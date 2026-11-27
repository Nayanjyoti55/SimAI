// Admin dashboard: live activity, orders, licence keys, payments, people, plans, installers, settings.
import { api, esc, exactRupees, rupees, size, state, until, when } from "../api.js";
import { $, $$, busy, copy, render, title, toast } from "../ui.js";

const TABS = [["overview", "Live overview"], ["orders", "Orders"], ["licences", "Licence keys"], ["payments", "Payments"],
              ["users", "People"], ["plans", "Plans & prices"], ["releases", "Installers"], ["security", "Security"], ["settings", "Settings"]];
let channel = null;
let feed = [];

function shell(tab, inner) {
  return `<div class="wrap admin">
    <nav class="tabs" aria-label="Admin sections">${TABS.map(([k, t]) =>
      `<a href="#/admin/${k}" ${k === tab ? 'aria-current="page"' : ""}>${t}</a>`).join("")}</nav>
    <section>${inner}</section></div>`;
}

export async function admin(params) {
  if (!state.session) { location.hash = "#/login?next=%23%2Fadmin"; return; }
  if (state.profile?.role !== "admin") { render(`<div class="wrap"><p class="err">Admins only.</p></div>`); return; }
  const tab = params.tab || "overview";
  title(`Admin · ${TABS.find((t) => t[0] === tab)?.[1] || ""}`, state.cfg.product_name);
  startLive();
  const fn = { overview, orders, licences, payments, users, plans, releases, security, settings }[tab] || overview;
  await fn(params);
}

// ------------------------------------------------------------------ live events (realtime)
function startLive() {
  if (channel) return;
  const push = (text) => {
    feed.unshift({ t: new Date(), text });
    feed = feed.slice(0, 80);
    const ul = $("#feed");
    if (ul) ul.insertAdjacentHTML("afterbegin", `<li class="new"><time>${new Date().toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" })}</time><span>${text}</span></li>`);
    if (location.hash.startsWith("#/admin/overview") || location.hash === "#/admin") refreshStats();
  };
  channel = state.sb.channel("admin-live")
    .on("postgres_changes", { event: "*", schema: "public", table: "orders" }, (p) => {
      const o = p.new || {};
      if (p.eventType === "INSERT") push(`New order <code>${esc(o.code)}</code> — ${exactRupees(o.amount_paise)}, waiting for payment`);
      else if (o.status === "paid" && p.old?.status !== "paid") push(`<b class="ok">Paid</b> <code>${esc(o.code)}</code> — ${exactRupees(o.amount_paise)}${o.utr ? ` · UTR ${esc(o.utr)}` : ""}`);
      else if (o.status && o.status !== p.old?.status) push(`Order <code>${esc(o.code)}</code> ${esc(o.status)}`);
    })
    .on("postgres_changes", { event: "INSERT", schema: "public", table: "licences" }, (p) =>
      push(`Key issued for ${esc(p.new.for_whom || "someone")} — ${esc(p.new.valid || "")} (${esc(p.new.source)})`))
    .on("postgres_changes", { event: "INSERT", schema: "public", table: "payment_events" }, (p) => {
      const e = p.new;
      push(`Payment confirmed by ${esc(e.source)}: ${e.amount_paise ? exactRupees(e.amount_paise) : "—"}${e.payer ? " from " + esc(e.payer) : ""}${e.note ? " · " + esc(e.note) : ""}`);
    })
    .on("postgres_changes", { event: "INSERT", schema: "public", table: "checkins" }, (p) =>
      push(`Check-in from a copy (${esc(p.new.ai_name || "")} v${esc(p.new.app_version || "")}) — ${esc(p.new.status)}${p.new.unlock_fails ? ` · ${p.new.unlock_fails} failed unlocks` : ""}`))
    .on("postgres_changes", { event: "INSERT", schema: "public", table: "profiles" }, (p) =>
      push(`New account: ${esc(p.new.username || p.new.email || "")}`))
    .subscribe();
}

async function refreshStats() {
  const box = $("#stats");
  if (!box) return;
  const s = await api("/api/admin/stats", { method: "POST", body: {} }).catch(() => null);
  if (!s) return;
  box.innerHTML = [
    [rupees(s.revenue_today), "today"], [rupees(s.revenue_month), "this month"], [rupees(s.revenue_total), "all time"],
    [s.orders_waiting, "payments in progress"], [s.licences_active, "active keys"], [s.copies_online_24h, "copies online (24 h)"],
    [s.users, "accounts"], [s.downloads, "downloads"],
  ].map(([b, t]) => `<div class="stat"><b>${b}</b><span>${t}</span></div>`).join("");
}

async function overview() {
  render(shell("overview", `<h1 class="admin-h">Live overview</h1>
    <div class="stats" id="stats"></div>
    <div class="panel" style="margin-top:18px"><h2>Happening now</h2>
      <p class="muted">Orders, payments, new keys and check-ins appear here the moment they happen.</p>
      <ul class="feed" id="feed">${feed.map((f) => `<li><time>${f.t.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" })}</time><span>${f.text}</span></li>`).join("")}</ul>
      ${feed.length ? "" : `<p class="muted" id="quiet">Quiet so far. Keep this page open.</p>`}
    </div>
    <div class="panel"><h2>Recent check-ins from installed copies</h2><div id="ci">Loading…</div></div>`));
  refreshStats();
  const { data } = await state.sb.from("checkins").select("*").order("ts", { ascending: false }).limit(25);
  $("#ci").innerHTML = (data || []).length ? `<div class="table-wrap"><table><thead><tr><th>Time</th><th>Key</th><th>AI name</th><th>Version</th><th>Windows</th><th>Failed unlocks</th><th>Status</th></tr></thead><tbody>
    ${data.map((c) => `<tr><td>${when(c.ts)}</td><td><code>${esc(c.kid?.slice(0, 8))}</code></td><td>${esc(c.ai_name)}</td><td>${esc(c.app_version)}</td><td>${esc(c.os)}</td><td>${c.unlock_fails ?? ""}</td><td>${esc(c.status)}</td></tr>`).join("")}
  </tbody></table></div>` : `<p class="muted">No check-ins yet.</p>`;
}

// ------------------------------------------------------------------ orders
async function orders(params) {
  const st = params.status || "";
  let q = state.sb.from("orders").select("*, profiles(username,email), plans(name)").order("created_at", { ascending: false }).limit(300);
  if (st) q = q.eq("status", st);
  const { data } = await q;
  render(shell("orders", `<h1 class="admin-h">Orders</h1>
    <div class="toolbar"><select id="st"><option value="">All</option>${["pending", "paid", "expired", "cancelled"].map((s) =>
      `<option ${s === st ? "selected" : ""}>${s}</option>`).join("")}</select>
      <input id="search" placeholder="Search code, user or UTR"></div>
    <div class="table-wrap"><table><thead><tr><th>Order</th><th>Person</th><th>Plan</th><th>Amount</th><th>Status</th><th>Created</th><th></th></tr></thead>
    <tbody id="rows">${(data || []).map((o) => `<tr data-s="${esc((o.code + " " + (o.profiles?.username || "") + " " + (o.profiles?.email || "") + " " + (o.utr || "")).toLowerCase())}">
      <td><code>${esc(o.code)}</code>${o.utr ? `<br><small>UTR ${esc(o.utr)}</small>` : ""}</td>
      <td>${esc(o.profiles?.username || o.profiles?.email || "")}</td><td>${esc(o.plans?.name || o.plan_id)}${o.kind === "renew" ? " (renew)" : ""}</td>
      <td>${exactRupees(o.amount_paise)}</td><td><span class="tag ${o.status === "paid" ? "ok" : o.status === "pending" ? "warn" : "muted"}">${esc(o.status)}</span></td><td>${when(o.created_at)}</td>
      <td>${o.status !== "paid" ? `<button class="btn btn-xs" data-recheck="${o.id}" title="Ask Razorpay again whether this was paid">Check payment</button>
        <button class="btn btn-xs btn-ghost" data-paid="${o.id}" title="Only for money you received some other way">Mark paid</button>` : ""}
        ${o.status === "paid" ? `<a href="#/invoice/${o.id}">Invoice</a>` : ""}</td></tr>`).join("")}</tbody></table></div>`));
  $("#st").addEventListener("change", () => { location.hash = `#/admin/orders${$("#st").value ? "?status=" + $("#st").value : ""}`; });
  filterRows();
  $$("[data-recheck]").forEach((b) => b.addEventListener("click", () => busy(b, async () => {
    const r = await api("/api/admin/recheck", { method: "POST", body: { order_id: b.dataset.recheck } });
    toast(r.status === "paid" ? `Paid — key ${r.kid || ""} issued.` : r.message, r.status !== "paid");
    orders(params);
  })));
  $$("[data-paid]").forEach((b) => b.addEventListener("click", () => {
    const utr = prompt("Only for money you received another way (cash, bank transfer).\nThis issues the key without Razorpay.\n\nReference / note (optional):", "");
    if (utr === null) return;
    busy(b, async () => {
      const r = await api("/api/admin/mark-paid", { method: "POST", body: { order_id: b.dataset.paid, utr: utr.trim() || null } });
      toast(`Paid — key issued (${r.kid}).`);
      orders(params);
    });
  }));
}

function filterRows() {
  $("#search")?.addEventListener("input", () => {
    const v = $("#search").value.toLowerCase().trim();
    $$("#rows tr").forEach((tr) => { tr.hidden = v && !tr.dataset.s.includes(v); });
  });
}

// ------------------------------------------------------------------ licences
async function licences() {
  const { data } = await state.sb.from("licences").select("*, profiles(username,email)").order("created_at", { ascending: false }).limit(1000);
  const { data: devRows } = await state.sb.from("licence_devices").select("*").eq("active", true).limit(10000);
  const devsOf = (kid) => (devRows || []).filter((d) => d.kid === kid);
  const { data: planList } = await state.sb.from("plans").select("id,name");
  render(shell("licences", `<h1 class="admin-h">Licence keys</h1>
    <details class="panel" ${data?.length ? "" : "open"}><summary>Make a key by hand</summary>
      <div class="grid-2">
        <div><label for="fw">For (name)</label><input id="fw" placeholder="e.g. Rahul"></div>
        <div><label for="us">Link to account (username or e-mail, optional)</label><input id="us"></div>
        <div><label for="len">Valid for</label><select id="len">
          <option value="600">10 minutes</option><option value="3600">1 hour</option><option value="86400">1 day</option>
          <option value="604800">7 days</option><option value="2592000" selected>1 month</option><option value="15724800">6 months</option>
          <option value="31536000">1 year</option><option value="0">Lifetime</option><option value="range">Date range…</option></select></div>
        <div><label for="start">Counting starts</label><select id="start"><option value="activation">When it's first activated</option><option value="now">Right now</option></select></div>
        <div class="rng" hidden><label for="from">From</label><input id="from" type="datetime-local"></div>
        <div class="rng" hidden><label for="to">To</label><input id="to" type="datetime-local"></div>
        <div><label for="pc">Lock to a PC code (optional)</label><input id="pc" placeholder="shown on the person's licence screen"></div>
        <div><label for="nt">Note</label><input id="nt" placeholder="e.g. paid cash"></div>
      </div>
      <p class="err" id="err"></p>
      <button class="btn" id="mk">Make key</button>
      <div id="newkey"></div>
    </details>
    <div class="toolbar" style="margin-top:18px"><input id="search" placeholder="Search name, account, key id, note">
      <select id="flt"><option value="">All keys</option><option value="on">Switched on</option><option value="off">Switched off</option></select></div>
    <div class="table-wrap"><table><thead><tr><th>For</th><th>Valid</th><th>Status</th><th>Devices</th><th>Last seen</th><th>From</th><th></th></tr></thead>
    <tbody id="rows">${(data || []).map((l) => `<tr data-s="${esc(((l.for_whom || "") + " " + (l.profiles?.username || "") + " " + (l.profiles?.email || "") + " " + l.kid + " " + (l.note || "")).toLowerCase())}" data-on="${l.enabled ? "on" : "off"}">
      <td>${esc(l.for_whom || l.profiles?.username || "—")}<br><small><code>${esc(l.kid)}</code> ${esc(l.note || "")}</small></td>
      <td>${l.not_after ? "until " + until(l.not_after) : esc(l.valid || "lifetime")}</td>
      <td>${l.enabled ? `<span class="tag ok">On</span>` : `<span class="tag danger">${l.renewed_to ? "Renewed" : "Off"}</span>`}</td>
      <td><b>${devsOf(l.kid).length} / ${Number(l.max_devices) || 2}</b><br>${devsOf(l.kid).map((d) =>
        `<small>${d.platform === "android" ? "📱" : "💻"} ${esc(d.name || "")} <a href="#" data-free="${esc(l.kid)}|${esc(d.device)}" title="Free this device's place">✕</a></small>`).join("<br>")}</td>
      <td>${when(l.last_seen)}</td><td>${esc(l.source)}</td>
      <td class="row"><button class="btn btn-xs btn-ghost" data-cp="${l.kid}">Copy</button>
        <button class="btn btn-xs ${l.enabled ? "btn-danger" : ""}" data-tg="${l.kid}" data-to="${l.enabled ? 0 : 1}">${l.enabled ? "Switch off" : "Switch on"}</button>
        ${l.activated_machine ? `<button class="btn btn-xs btn-ghost" data-reset="${l.kid}">Free PC</button>` : ""}
        ${l.activated_phone ? `<button class="btn btn-xs btn-ghost" data-resetp="${l.kid}">Free phone</button>` : ""}
        <button class="btn btn-xs btn-ghost" data-max="${l.kid}" data-cur="${Number(l.max_devices) || 2}">Devices…</button>
        <button class="btn btn-xs btn-ghost" data-ext="${l.kid}">Extend</button>
        <button class="btn btn-xs btn-danger" data-del="${l.kid}">Delete</button></td></tr>`).join("")}</tbody></table></div>`));
  void planList;
  const keys = Object.fromEntries((data || []).map((l) => [l.kid, l]));
  $("#len").addEventListener("change", () => $$(".rng").forEach((e) => { e.hidden = $("#len").value !== "range"; }));
  $("#mk").addEventListener("click", () => busy($("#mk"), async () => {
    const len = $("#len").value;
    const body = { for_whom: $("#fw").value.trim(), user: $("#us").value.trim(), note: $("#nt").value.trim(),
                   machine: $("#pc").value.trim(), start: $("#start").value };
    if (len === "range") { body.from = $("#from").value; body.to = $("#to").value; }
    else body.seconds = Number(len);
    const r = await api("/api/admin/issue-key", { method: "POST", body });
    $("#newkey").innerHTML = `<p class="ok" style="margin-top:14px">Key made — valid ${esc(r.licence.valid)}.</p>
      <div class="keybox">${esc(r.key)}</div><button class="btn btn-sm" id="cpnew" style="margin-top:8px">Copy key</button>`;
    $("#cpnew").addEventListener("click", () => copy(r.key, "Key copied"));
  }, $("#err")));
  filterRows();
  $("#flt").addEventListener("change", () => $$("#rows tr").forEach((tr) => { tr.hidden = $("#flt").value && tr.dataset.on !== $("#flt").value; }));
  $$("[data-cp]").forEach((b) => b.addEventListener("click", () => copy(keys[b.dataset.cp].key, "Key copied")));
  $$("[data-tg]").forEach((b) => b.addEventListener("click", () => busy(b, async () => {
    const { error } = await state.sb.from("licences").update({ enabled: b.dataset.to === "1" }).eq("kid", b.dataset.tg);
    if (error) throw error;
    toast(b.dataset.to === "1" ? "Switched on." : "Switched off — the copy using it stops within ~10 minutes.");
    licences();
  })));
  $$("[data-reset]").forEach((b) => b.addEventListener("click", () => busy(b, async () => {
    await api("/api/admin/reset-pc", { method: "POST", body: { kid: b.dataset.reset } });
    toast("This key can now be activated on another PC.");
    licences();
  })));
  $$("[data-resetp]").forEach((b) => b.addEventListener("click", () => busy(b, async () => {
    await api("/api/admin/reset-phone", { method: "POST", body: { kid: b.dataset.resetp } });
    toast("This key can now be activated on another phone.");
    licences();
  })));
  $$("[data-free]").forEach((a) => a.addEventListener("click", (e) => {
    e.preventDefault();
    const [kid, device] = a.dataset.free.split("|");
    if (!confirm("Free this device's place? SIM on it switches to basic features.")) return;
    busy(a, async () => {
      await api("/api/admin/release-device", { method: "POST", body: { kid, device } });
      toast("Device freed.");
      licences();
    });
  }));
  $$("[data-max]").forEach((b) => b.addEventListener("click", () => {
    const n = prompt("How many devices (PCs + phones together) may use this key at the same time?", b.dataset.cur);
    if (n === null) return;
    busy(b, async () => {
      await api("/api/admin/set-max-devices", { method: "POST", body: { kid: b.dataset.max, max_devices: Number(n) } });
      toast("Saved.");
      licences();
    });
  }));
  $$("[data-ext]").forEach((b) => b.addEventListener("click", () => {
    const days = prompt("Make a replacement key valid for how many days from now? (0 = lifetime)\nThe old key is switched off.", "30");
    if (days === null) return;
    busy(b, async () => {
      const r = await api("/api/admin/replace-key", { method: "POST", body: { kid: b.dataset.ext, days: Number(days), start: "now" } });
      await copy(r.key, "New key copied");
      licences();
    });
  }));
  $$("[data-del]").forEach((b) => b.addEventListener("click", () => {
    if (!confirm("Delete this key? The copy using it stops at its next check and the installer refuses it.")) return;
    busy(b, async () => {
      const { error } = await state.sb.from("licences").delete().eq("kid", b.dataset.del);
      if (error) throw error;
      toast("Deleted.");
      licences();
    });
  }));
}

// ------------------------------------------------------------------ payments
async function payments() {
  const [cfg, sec] = await Promise.all([api("/api/config").catch(() => ({})),
                                        api("/api/admin/secrets-get", { method: "POST", body: {} }).catch(() => ({}))]);
  const { data: ev } = await state.sb.from("payment_events").select("*, orders(code)").order("received_at", { ascending: false }).limit(200);
  const hook = `${location.origin}/api/razorpay/webhook`;
  const ready = cfg.payments_ready;
  render(shell("payments", `<h1 class="admin-h">Payments</h1>
    <div class="panel"><h2>How payments are confirmed</h2>
      <p>Every order gets its own UPI QR from Razorpay, for exactly that amount, usable once. A key is issued only when
        Razorpay's own servers report the payment as <b>captured</b> (money received) for that QR and that amount.
        The buyer never uploads a screenshot or UTR, and nothing depends on your phone. Razorpay sends the money to your bank account.</p>
      <ul class="checklist">
        <li class="${ready ? "done" : ""}">Razorpay keys saved in Settings${ready ? (cfg.test_mode ? " (test mode — no real money)" : " (live)") : " — not yet"}</li>
        <li class="${sec.razorpay_webhook_secret_set ? "done" : ""}">Webhook secret saved${sec.razorpay_webhook_secret_set ? "" : " — not yet (payments still work, the page checks every few seconds; the webhook makes it instant)"}</li>
      </ul>
      <label>Webhook URL (Razorpay › Account &amp; Settings › Webhooks › Add new)</label>
      <div class="row"><code class="keybox grow">${esc(hook)}</code><button class="btn btn-sm" id="cph">Copy</button></div>
      <p class="hint">Events: <code>qr_code.credited</code> and <code>payment.captured</code>. Secret: the webhook secret from Settings.</p>
      <div class="row" style="margin-top:14px"><button class="btn btn-sm" id="tst">Test my Razorpay keys</button><span id="tres" class="hint"></span></div>
    </div>
    <div class="panel"><h2>Confirmed payments</h2>
      <div class="table-wrap"><table><thead><tr><th>Time</th><th>Amount</th><th>UPI ref (RRN)</th><th>Paid from</th><th>Confirmed by</th><th>Order</th></tr></thead><tbody>
      ${(ev || []).map((e) => `<tr><td>${when(e.received_at)}</td><td>${e.amount_paise ? exactRupees(e.amount_paise) : "—"}</td>
        <td>${esc(e.utr || "")}</td><td>${esc(e.payer || "")}</td><td>${esc(e.source)}<br><small>${esc(e.note || "")}</small></td>
        <td>${e.orders?.code ? `<code>${esc(e.orders.code)}</code>` : ""}</td></tr>`).join("") || `<tr><td colspan="6" class="muted">No payments yet.</td></tr>`}
      </tbody></table></div></div>`));
  $("#cph").addEventListener("click", () => copy(hook, "Webhook URL copied"));
  $("#tst").addEventListener("click", (e) => busy(e.currentTarget, async () => {
    try {
      const r = await api("/api/admin/test-razorpay", { method: "POST", body: {} });
      $("#tres").innerHTML = `<span class="ok">Razorpay answered — keys work${r.test_mode ? " (test mode)" : " (live)"}.</span>`;
    } catch (err) { $("#tres").innerHTML = `<span class="danger">${esc(err.message)}</span>`; }
  }));
}

// ------------------------------------------------------------------ users
async function users() {
  const { data } = await state.sb.from("profiles").select("*").order("created_at", { ascending: false }).limit(1000);
  render(shell("users", `<h1 class="admin-h">People</h1>
    <div class="toolbar"><input id="search" placeholder="Search username or e-mail"></div>
    <div class="table-wrap"><table><thead><tr><th>Username</th><th>E-mail</th><th>Role</th><th>Joined</th><th></th></tr></thead>
    <tbody id="rows">${(data || []).map((u) => `<tr data-s="${esc(((u.username || "") + " " + (u.email || "")).toLowerCase())}">
      <td>${esc(u.username || "—")}${u.banned ? ' <span class="tag danger">blocked</span>' : ""}</td><td>${esc(u.email || "")}</td>
      <td>${esc(u.role)}</td><td>${when(u.created_at)}</td>
      <td class="row">${u.id === state.profile.id ? "<span class='muted'>you</span>" : `
        <button class="btn btn-xs ${u.banned ? "" : "btn-danger"}" data-ban="${u.id}" data-to="${u.banned ? 0 : 1}">${u.banned ? "Unblock" : "Block"}</button>
        <button class="btn btn-xs btn-ghost" data-role="${u.id}" data-to="${u.role === "admin" ? "user" : "admin"}">${u.role === "admin" ? "Remove admin" : "Make admin"}</button>`}</td></tr>`).join("")}</tbody></table></div>`));
  filterRows();
  $$("[data-ban]").forEach((b) => b.addEventListener("click", () => busy(b, async () => {
    await api("/api/admin/set-user", { method: "POST", body: { id: b.dataset.ban, banned: b.dataset.to === "1" } });
    users();
  })));
  $$("[data-role]").forEach((b) => b.addEventListener("click", () => {
    if (!confirm(b.dataset.to === "admin" ? "Give this person full admin access?" : "Remove admin access?")) return;
    busy(b, async () => { await api("/api/admin/set-user", { method: "POST", body: { id: b.dataset.role, role: b.dataset.to } }); users(); });
  }));
}

// ------------------------------------------------------------------ plans
async function plans() {
  const { data } = await state.sb.from("plans").select("*").order("sort");
  const row = (p = {}) => `<tr data-id="${esc(p.id || "")}">
    <td><input value="${esc(p.id || "")}" data-f="id" ${p.id ? "readonly" : ""} placeholder="e.g. 3months"></td>
    <td><input value="${esc(p.name || "")}" data-f="name"></td>
    <td><input type="number" min="0" value="${p.duration_days ?? 30}" data-f="duration_days" title="0 = lifetime"></td>
    <td><input type="number" min="1" step="0.01" value="${p.price_paise ? (p.price_paise / 100).toFixed(2) : ""}" data-f="price"></td>
    <td><input type="number" min="1" max="50" value="${p.max_devices ?? 2}" data-f="max_devices" style="width:70px" title="PCs + phones at once"></td>
    <td><input value="${esc(p.badge || "")}" data-f="badge"></td>
    <td><input value="${esc(p.description || "")}" data-f="description"></td>
    <td><input type="number" value="${p.sort ?? 0}" data-f="sort" style="width:70px"></td>
    <td><input type="checkbox" data-f="active" ${p.active !== false ? "checked" : ""}></td></tr>`;
  render(shell("plans", `<h1 class="admin-h">Plans and prices</h1>
    <p class="muted">Days = how long a key lasts (0 = lifetime). Price in rupees. Devices = how many PCs and phones one key may be used on at the same time (a device that signs out or is removed frees its place). Untick “On sale” to hide a plan.</p>
    <div class="table-wrap"><table><thead><tr><th>Id</th><th>Name</th><th>Days</th><th>Price ₹</th><th>Devices</th><th>Badge</th><th>Description</th><th>Order</th><th>On sale</th></tr></thead>
    <tbody id="rows">${(data || []).map((p) => row(p)).join("")}</tbody></table></div>
    <div class="row" style="margin-top:14px"><button class="btn btn-ghost" id="add">Add a plan</button><button class="btn" id="save">Save plans</button></div>
    <p class="err" id="err"></p>`));
  $("#add").addEventListener("click", () => $("#rows").insertAdjacentHTML("beforeend", row()));
  $("#save").addEventListener("click", () => busy($("#save"), async () => {
    const rows = $$("#rows tr").map((tr) => {
      const v = (f) => tr.querySelector(`[data-f=${f}]`);
      return { id: v("id").value.trim(), name: v("name").value.trim(), duration_days: Number(v("duration_days").value || 0),
               price_paise: Math.round(Number(v("price").value || 0) * 100), badge: v("badge").value.trim(),
               max_devices: Math.max(1, Number(v("max_devices").value || 2)),
               description: v("description").value.trim(), sort: Number(v("sort").value || 0), active: v("active").checked };
    }).filter((r) => r.id && r.name);
    if (rows.some((r) => r.price_paise < 100)) throw new Error("Every price must be at least ₹1.");
    const { error } = await state.sb.from("plans").upsert(rows);
    if (error) throw error;
    toast("Plans saved.");
    plans();
  }, $("#err")));
}

// ------------------------------------------------------------------ security (v3.2)
async function security() {
  const d = await api("/api/admin/security", { method: "POST", body: {} });
  render(shell("security", `<h1 class="admin-h">Security</h1>
    <div class="panel"><h2>Blocked addresses</h2>
      <p class="muted">Addresses that kept failing (password guessing, made-up licence keys, forged payment notices) are blocked automatically for a while.</p>
      ${d.blocked_ips.length ? `<div class="table-wrap"><table><thead><tr><th>Address</th><th>Why</th><th>Since</th><th>Until</th><th></th></tr></thead><tbody>
      ${d.blocked_ips.map((b) => `<tr><td><code>${esc(b.ip)}</code></td><td>${esc(b.reason || "")}</td><td>${when(b.blocked_at)}</td>
        <td>${b.until ? when(b.until) : "for good"}</td><td><button class="btn btn-xs btn-ghost" data-unb="${esc(b.ip)}">Unblock</button></td></tr>`).join("")}
      </tbody></table></div>` : `<p class="muted">Nothing blocked.</p>`}
      <div class="row" style="margin-top:10px"><input id="bip" placeholder="Block an address, e.g. 203.0.113.9"><button class="btn btn-sm btn-danger" id="bipgo">Block</button></div>
    </div>
    <div class="panel"><h2>Threat fingerprints for SIM Shield</h2>
      <p class="muted">Every copy of SIM downloads these and flags matching files. Add one from SIM's quarantine (“Share with all my copies”) or here.</p>
      <div class="row"><input id="sha" placeholder="SHA-256 (64 letters)" style="flex:2"><input id="sname" placeholder="Name, e.g. Trojan.FakeInvoice" style="flex:1"><button class="btn btn-sm" id="shago">Add</button></div>
      <div class="table-wrap"><table><tbody>${d.signatures.map((s) => `<tr><td><code>${esc(s.sha256.slice(0, 20))}…</code></td><td>${esc(s.name)}</td><td>${when(s.added_at)}</td>
        <td><button class="btn btn-xs btn-ghost" data-rs="${esc(s.sha256)}">Remove</button></td></tr>`).join("")}</tbody></table></div>
    </div>
    <div class="panel"><h2>Blocked websites</h2>
      <p class="muted">SIM warns about these sites and refuses to open them, on every copy.</p>
      <div class="row"><input id="dom" placeholder="bad-site.xyz"><button class="btn btn-sm" id="domgo">Block site</button></div>
      <div class="table-wrap"><table><tbody>${d.domains.map((x) => `<tr><td>${esc(x.domain)}</td><td>${when(x.added_at)}</td>
        <td><button class="btn btn-xs btn-ghost" data-rd="${esc(x.domain)}">Remove</button></td></tr>`).join("")}</tbody></table></div>
    </div><p class="err" id="err"></p>`));
  const act = (action, body, msg) => busy(document.activeElement, async () => {
    await api(`/api/admin/${action}`, { method: "POST", body });
    toast(msg);
    security();
  }, $("#err"));
  $$("[data-unb]").forEach((b) => b.addEventListener("click", () => act("unblock-ip", { ip: b.dataset.unb }, "Unblocked.")));
  $$("[data-rs]").forEach((b) => b.addEventListener("click", () => act("remove-signature", { sha256: b.dataset.rs }, "Removed.")));
  $$("[data-rd]").forEach((b) => b.addEventListener("click", () => act("remove-domain", { domain: b.dataset.rd }, "Removed.")));
  $("#bipgo").addEventListener("click", () => act("block-ip", { ip: $("#bip").value.trim() }, "Blocked."));
  $("#shago").addEventListener("click", () => act("add-signature", { sha256: $("#sha").value.trim(), name: $("#sname").value.trim() }, "Added - every copy picks it up at its next update."));
  $("#domgo").addEventListener("click", () => act("add-domain", { domain: $("#dom").value.trim() }, "Blocked on every copy."));
}

// ------------------------------------------------------------------ releases (installers)
async function releases() {
  const { data } = await state.sb.from("releases").select("*").order("created_at", { ascending: false });
  render(shell("releases", `<h1 class="admin-h">Installers</h1>
    <div class="panel"><h2>Publish a new version</h2>
      <p class="muted">Big installers: upload the .exe to a GitHub Release (free, up to 2 GB) and paste its download link.
        Small files (under your Supabase plan's limit, 50 MB on the free plan) can be uploaded here.</p>
      <div class="grid-2"><div><label for="plat">For</label><select id="plat"><option value="windows">Windows (.exe installer)</option>
          <option value="android">Android (.apk app)</option></select></div><div></div>
        <div><label for="ver">Version</label><input id="ver" placeholder="3.10"></div>
        <div><label for="url">Download link</label><input id="url" placeholder="https://github.com/you/sim/releases/download/v3.10/SIM_Setup_3.10.exe"></div></div>
      <label for="file">…or upload the file</label><input id="file" type="file" accept=".exe,.zip,.msi,.apk">
      <label for="notes">What's new</label><textarea id="notes" rows="4"></textarea>
      <p class="err" id="err"></p><button class="btn" id="pub">Publish</button></div>
    <div class="panel"><h2>Published</h2><div class="table-wrap"><table><thead><tr><th>Version</th><th>Date</th><th>Size</th><th>Downloads</th><th>Visible</th><th></th></tr></thead><tbody>
      ${(data || []).map((r) => `<tr><td>${r.platform === "android" ? "📱 Android" : "🪟 Windows"} ${esc(r.version)}<br><small><a href="${esc(r.url)}">${esc(r.file_name || r.url).slice(0, 60)}</a></small></td>
        <td>${when(r.created_at)}</td><td>${size(r.size_bytes)}</td><td>${r.downloads}</td>
        <td><input type="checkbox" data-pub="${r.id}" ${r.published ? "checked" : ""}></td>
        <td><button class="btn btn-xs btn-danger" data-del="${r.id}">Delete</button></td></tr>`).join("") || `<tr><td colspan="6" class="muted">Nothing published yet.</td></tr>`}
    </tbody></table></div></div>`));
  $("#pub").addEventListener("click", () => busy($("#pub"), async () => {
    const version = $("#ver").value.trim();
    if (!version) throw new Error("Type the version number.");
    let url = $("#url").value.trim(), file_name = "", size_bytes = 0;
    const f = $("#file").files[0];
    if (f) {
      const path = `${$("#plat").value}/${version}/${f.name.replace(/[^\w.-]/g, "_")}`;
      const up = await state.sb.storage.from("releases").upload(path, f, { upsert: true, contentType: /\.apk$/i.test(f.name) ? "application/vnd.android.package-archive" : "application/octet-stream" });
      if (up.error) throw new Error(`Upload failed: ${up.error.message}. Use a GitHub Release link for large files.`);
      url = state.sb.storage.from("releases").getPublicUrl(path).data.publicUrl;
      file_name = f.name; size_bytes = f.size;
    }
    if (!/^https?:\/\//.test(url)) throw new Error("Paste a download link or choose a file.");
    if (!file_name) file_name = decodeURIComponent(url.split("/").pop() || "");
    const platform = $("#plat").value;
    if (platform === "android" && !/\.apk$/i.test(file_name)) throw new Error("For Android, publish the .apk file (the .aab is only for the Play Store).");
    const { error } = await state.sb.from("releases").insert({ version, url, file_name, size_bytes, platform, notes: $("#notes").value.trim() });
    if (error) throw error;
    toast(`Version ${version} is live on the download page.`);
    releases();
  }, $("#err")));
  $$("[data-pub]").forEach((c) => c.addEventListener("change", async () => {
    await state.sb.from("releases").update({ published: c.checked }).eq("id", c.dataset.pub);
    toast(c.checked ? "Visible on the download page." : "Hidden.");
  }));
  $$("[data-del]").forEach((b) => b.addEventListener("click", () => {
    if (!confirm("Delete this release from the list?")) return;
    busy(b, async () => { await state.sb.from("releases").delete().eq("id", b.dataset.del); releases(); });
  }));
}

// ------------------------------------------------------------------ settings
async function settings() {
  const { data: s } = await state.sb.from("site_settings").select("*").eq("id", 1).maybeSingle();
  const sec = await api("/api/admin/secrets-get", { method: "POST", body: {} }).catch(() => ({}));
  const t = (id, label, hint = "", type = "text") => `<label for="${id}">${label}</label><input id="${id}" type="${type}" value="${esc(s?.[id] ?? "")}">${hint ? `<p class="hint">${hint}</p>` : ""}`;
  const c = (id, label, hint = "") => `<label class="check"><input type="checkbox" id="${id}" ${s?.[id] ? "checked" : ""}> <span>${label}${hint ? `<br><small>${hint}</small>` : ""}</span></label>`;
  render(shell("settings", `<h1 class="admin-h">Settings</h1>
    <div class="panel"><h2>Website</h2><div class="grid-2">
      <div>${t("product_name", "Product name")}</div><div>${t("tagline", "Tagline")}</div>
      <div>${t("made_by", "Made by", "Shown at the bottom left of every page")}</div><div>${t("powered_by", "Powered by", "Shown next to it")}</div>
      <div>${t("support_email", "Support e-mail", "", "email")}</div></div></div>
    <div class="panel"><h2>Selling</h2>
      ${c("payments_enabled", "Sell licence keys on the website", "Off: the Buy buttons say sales are paused.")}
      <div class="grid-2"><div>${t("payment_window_min", "Minutes a payment QR stays open", "5 to 60", "number")}</div>
        <div>${t("refund_days", "Refund window (days), shown in the terms", "", "number")}</div></div></div>
    <div class="panel"><h2>Licence keys</h2>
      ${c("auto_issue", "Give the key the moment the payment is detected", "Off: keys are made switched-off; you switch them on in Licence keys.")}
      ${c("installer_check", "Installer and app accept only keys registered here and switched on", "Off: any genuine key you signed is accepted, even if it's not in the list.")}
      ${c("one_pc_per_key", "Limit devices per key", "A key works on as many devices at once as its plan allows (Plans & prices › Devices). A device that signs out, is uninstalled, or is removed in My licences frees its place.")}</div>
    <div class="panel"><h2>Shared AI brain</h2>
      <p class="hint">Copies you export (and the Android app) can use your Groq key through this website, so buyers don't need their own.
        The key stays on the server; each licence has a daily limit. Groq's free plan limits apply to ALL users together —
        for many users, upgrade to Groq's Developer plan.</p>
      ${c("ai_enabled", "Let licensed copies use the shared AI brain")}
      <div class="grid-2"><div><label for="gk">Groq API key</label><input id="gk" type="password" autocomplete="new-password" placeholder="${sec.groq_api_key_set ? "saved — type to replace" : "not set (console.groq.com › API Keys)"}"></div>
        <div>${t("ai_daily_limit", "Requests per licence per day", "One question can use 1–3 requests", "number")}</div>
        <div>${t("ai_model", "Model (empty = automatic)", "e.g. openai/gpt-oss-120b")}</div></div>
      <p class="hint" id="aiuse"></p></div>
    <div class="panel"><h2>Android app</h2>
      <div class="grid-2"><div>${t("play_store_url", "Google Play link (once published)", "Shown on the download page next to the APK")}</div></div></div>
    <div class="panel"><h2>Razorpay (confirms every payment)</h2>
      <p class="hint">Razorpay dashboard › Account &amp; Settings › API keys. Use the <code>rzp_test_…</code> pair while testing, then the <code>rzp_live_…</code> pair.</p>
      <div class="grid-2"><div>${t("razorpay_key_id", "Key id")}</div>
        <div><label for="rks">Key secret</label><input id="rks" type="password" autocomplete="new-password" placeholder="${sec.razorpay_key_secret_set ? "saved — type to replace" : "not set"}"></div>
        <div><label for="rws">Webhook secret</label><input id="rws" type="password" autocomplete="new-password" placeholder="${sec.razorpay_webhook_secret_set ? "saved — type to replace" : "not set"}">
          <p class="hint">Or <button class="linkbtn" id="genws" type="button">make one for me</button>, then paste it into Razorpay's webhook form.</p></div></div>
      <p class="hint" id="wsout"></p></div>
    <div class="panel"><h2>Invoices</h2><div class="grid-2">
      <div>${t("business_name", "Business name")}</div><div>${t("gstin", "GSTIN (optional)")}</div></div>
      <label for="business_address">Address</label><textarea id="business_address" rows="3">${esc(s?.business_address || "")}</textarea></div>
    <p class="err" id="err"></p><button class="btn" id="save">Save settings</button>`));
  $("#save").addEventListener("click", () => busy($("#save"), async () => {
    const v = (id) => $(`#${id}`);
    const patch = { updated_at: new Date().toISOString() };
    for (const id of ["product_name", "tagline", "made_by", "powered_by", "support_email", "play_store_url", "ai_model",
                      "razorpay_key_id", "business_name", "gstin", "business_address"]) patch[id] = v(id).value.trim();
    patch.ai_daily_limit = Math.max(0, Math.min(100000, Number(v("ai_daily_limit").value || 300)));
    patch.ai_enabled = v("ai_enabled").checked;
    if (patch.play_store_url && !/^https:\/\/play\.google\.com\//.test(patch.play_store_url)) throw new Error("The Play link starts with https://play.google.com/");
    patch.payment_window_min = Math.max(5, Math.min(60, Number(v("payment_window_min").value || 15)));
    patch.refund_days = Math.max(0, Math.min(60, Number(v("refund_days").value || 7)));
    for (const id of ["payments_enabled", "auto_issue", "installer_check", "one_pc_per_key"]) patch[id] = v(id).checked;
    if (patch.razorpay_key_id && !/^rzp_(test|live)_\w+$/.test(patch.razorpay_key_id)) throw new Error("The Razorpay key id starts with rzp_test_ or rzp_live_.");
    const { error } = await state.sb.from("site_settings").update(patch).eq("id", 1);
    if (error) throw error;
    if ($("#rks").value || $("#rws").value || $("#gk").value)
      await api("/api/admin/secrets-set", { method: "POST", body: { razorpay_key_secret: $("#rks").value,
        razorpay_webhook_secret: $("#rws").value, groq_api_key: $("#gk").value } });
    state.cfg.play_store_url = patch.play_store_url;
    state.cfg = { ...state.cfg, product_name: patch.product_name, made_by: patch.made_by, powered_by: patch.powered_by,
                  tagline: patch.tagline, support_email: patch.support_email };
    document.dispatchEvent(new CustomEvent("brand-changed"));       // footer + header update straight away
    toast("Settings saved.");
    settings();
  }, $("#err")));
  api("/api/admin/ai-usage", { method: "POST", body: {} }).then((u) => {
    $("#aiuse").textContent = `Today: ${u.total} shared-brain request${u.total === 1 ? "" : "s"} from ${u.rows.length} licence${u.rows.length === 1 ? "" : "s"}.`;
  }).catch(() => {});
  $("#genws").addEventListener("click", (e) => {
    if (!confirm("Make a new webhook secret? Razorpay's webhook must then use this new one.")) return;
    busy(e.currentTarget, async () => {
      const r = await api("/api/admin/secrets-set", { method: "POST", body: { generate_webhook_secret: true } });
      $("#wsout").innerHTML = `New webhook secret (saved): <code class="keybox">${esc(r.generated_webhook_secret)}</code> — paste it into Razorpay now.`;
    });
  });
}
