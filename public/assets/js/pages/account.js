// My licences, buying / renewing, the payment page, invoices.
import { api, day, esc, exactRupees, rupees, state, until, when } from "../api.js";
import { $, $$, busy, copy, isPhone, render, title, toast } from "../ui.js";

const needLogin = (next) => {
  if (state.session) return false;
  location.hash = `#/login?next=${encodeURIComponent(next)}`;
  return true;
};

const statusTag = (l) => {
  const end = Number(l.not_after);
  if (!l.enabled && l.renewed_to) return `<span class="tag muted">Renewed</span>`;
  if (!l.enabled) return `<span class="tag danger">Switched off</span>`;
  if (end && end * 1000 < Date.now()) return `<span class="tag warn">Expired</span>`;
  return `<span class="tag ok">Active</span>`;
};

export async function account() {
  if (needLogin("#/account")) return;
  title("My licences", state.cfg.product_name);
  const uid = state.session.user.id;
  const [{ data: lic }, { data: orders }] = await Promise.all([
    state.sb.from("licences").select("*").eq("user_id", uid).order("created_at", { ascending: false }),
    state.sb.from("orders").select("*, plans(name)").eq("user_id", uid).order("created_at", { ascending: false }).limit(50),
  ]);
  const kids = (lic || []).filter((l) => l.enabled).map((l) => l.kid);
  const { data: devs } = kids.length ? await state.sb.from("licence_devices").select("*").in("kid", kids).eq("active", true)
    .order("last_seen", { ascending: false }) : { data: [] };
  const devsOf = (kid) => (devs || []).filter((d) => d.kid === kid);
  const p = state.profile || {};
  render(`<div class="wrap">
    <div class="page-head"><h1>Hi ${esc(p.username || "there")}</h1>
      <p>Your licence keys, renewals and invoices.</p>
      <div class="row"><a class="btn" href="#/pricing">Buy a new key</a>
        ${p.role === "admin" ? `<a class="btn btn-ghost" href="#/admin">Admin dashboard</a>` : ""}</div></div>
    <div class="panel"><h2>Licence keys</h2>
      ${(lic || []).length ? `<div class="table-wrap"><table><thead><tr><th>Key</th><th>Valid</th><th>Status</th><th>Devices</th><th></th></tr></thead><tbody>
      ${lic.map((l) => `<tr>
        <td><code>${esc(l.key.slice(0, 13))}…</code><br><small>${esc(l.note || "")}</small></td>
        <td>${l.not_after ? "until " + until(l.not_after) : esc(l.valid || "lifetime")}</td>
        <td>${statusTag(l)}</td>
        <td>${l.enabled ? `${devsOf(l.kid).length} of ${Number(l.max_devices) || 2}` : "<span class='muted'>—</span>"}</td>
        <td class="row"><button class="btn btn-xs btn-ghost" data-copy="${esc(l.kid)}">Copy key</button>
          ${l.enabled ? `<a class="btn btn-xs" href="#/buy/renew?renew=${esc(l.kid)}">Renew or upgrade</a>` : ""}</td></tr>`).join("")}
      </tbody></table></div>` : `<p>You don't have a key yet. <a href="#/pricing">Buy one</a> — it appears here the moment you pay.</p>`}
    </div>
    ${(devs || []).length ? `<div class="panel"><h2>Devices using your keys</h2>
      <p class="muted">Each key works on a set number of devices at once. Remove a device you no longer use (or lost) to free its place - then the key can be activated on a new one.</p>
      <div class="table-wrap"><table><thead><tr><th>Device</th><th>Key</th><th>Last seen</th><th></th></tr></thead><tbody>
      ${devs.map((d) => `<tr><td>${d.platform === "android" ? "📱" : "💻"} ${esc(d.name || (d.platform === "android" ? "Phone" : "PC"))}</td>
        <td><code>${esc(d.kid.slice(0, 8))}</code></td><td>${when(d.last_seen)}</td>
        <td><button class="btn btn-xs btn-danger" data-rel="${esc(d.kid)}|${esc(d.device)}|${esc(d.platform)}">Remove</button></td></tr>`).join("")}
      </tbody></table></div></div>` : ""}
    <div class="panel"><h2>Payments and invoices</h2>
      ${(orders || []).length ? `<div class="table-wrap"><table><thead><tr><th>Order</th><th>Plan</th><th>Amount</th><th>Status</th><th>Date</th><th></th></tr></thead><tbody>
      ${orders.map((o) => `<tr><td><code>${esc(o.code)}</code></td><td>${esc(o.plans?.name || o.plan_id)}${o.kind === "renew" ? " (renewal)" : ""}</td>
        <td>${exactRupees(o.amount_paise)}</td><td><span class="tag ${o.status === "paid" ? "ok" : o.status === "pending" ? "warn" : "muted"}">${esc(o.status)}</span></td><td>${when(o.created_at)}</td>
        <td>${o.status === "paid" ? `<a href="#/invoice/${o.id}">Invoice</a>` : o.status === "pending" ? `<a href="#/pay/${o.id}">Continue paying</a>` : ""}</td></tr>`).join("")}
      </tbody></table></div>` : `<p class="muted">No payments yet.</p>`}
    </div>
    <div class="panel"><h2>Account</h2>
      <p>Username <b>${esc(p.username || "—")}</b> · e-mail ${esc(state.session.user.email || "—")}</p>
      <div class="row"><a class="btn btn-sm btn-ghost" href="#/choose-username">Change username</a>
        <a class="btn btn-sm btn-ghost" href="#/new-password">Change password</a>
        <button class="btn btn-sm btn-danger" id="out">Sign out</button></div>
    </div>
  </div>`);
  $$("[data-copy]").forEach((b) => b.addEventListener("click", () => {
    const l = lic.find((x) => x.kid === b.dataset.copy);
    copy(l.key, "Licence key copied");
  }));
  $$("[data-rel]").forEach((b) => b.addEventListener("click", () => {
    const [kid, device, platform] = b.dataset.rel.split("|");
    const l = lic.find((x) => x.kid === kid);
    if (!l || !confirm("Remove this device? SIM on it switches to basic features until the key is activated there again.")) return;
    busy(b, async () => {
      await api("/api/licence-release", { method: "POST", body: { key: l.key, device, platform } });
      toast("Device removed - its place is free.");
      account();
    });
  }));
  $("#out").addEventListener("click", async () => {
    const { signOut } = await import("../api.js");
    await signOut();
    location.hash = "#/";
  });
}

// ------------------------------------------------------------------ checkout: choose a payment method, pay, get the key
const SVG = {
  qr: `<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><path d="M14 14h3v3h-3zM20 14v.01M14 20h.01M17 17h3v3"/></svg>`,
  app: `<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><rect x="6" y="2.5" width="12" height="19" rx="2.5"/><path d="M10.5 18.5h3"/><path d="M9.5 9.5l2 2 3.5-4"/></svg>`,
  shield: `<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M12 3 4.5 6v5.5c0 4.4 3.1 8.3 7.5 9.5 4.4-1.2 7.5-5.1 7.5-9.5V6Z"/><path d="m8.8 12 2.2 2.2 4.2-4.4"/></svg>`,
  check: `<svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" aria-hidden="true"><path d="m5 12.5 4.5 4.5L19 7.5"/></svg>`,
};
// Brand icons are not drawn here: put the official icon files in public/assets/img/apps/ (gpay.svg / phonepe.svg /
// paytm.svg, or .png) and they appear automatically; until then a neutral phone icon is shown.
const METHODS = [
  { id: "qr", name: "UPI QR code", sub: "Scan with any UPI app", icon: SVG.qr },
  { id: "gpay", name: "Google Pay", scheme: "tez://upi/pay", file: "gpay" },
  { id: "phonepe", name: "PhonePe", scheme: "phonepe://pay", file: "phonepe" },
  { id: "paytm", name: "Paytm", scheme: "paytmmp://pay", file: "paytm" },
  { id: "upi", name: "Other UPI app", sub: "BHIM, your bank's app and others", scheme: "upi://pay", icon: SVG.app },
];
const methodById = (id) => METHODS.find((m) => m.id === id) || METHODS[0];
const appLink = (m, upi) => (upi && m.scheme ? `${m.scheme}?${upi.split("?")[1] || ""}` : "");
const planLength = (p) => (p?.duration_days ? `${p.duration_days} days` : "Lifetime");

function appIcons(root = document) {
  $$("img[data-app]", root).forEach((img) => {
    const tries = [`/assets/img/apps/${img.dataset.app}.svg`, `/assets/img/apps/${img.dataset.app}.png`];
    let i = 0;
    img.onerror = () => { if (++i < tries.length) img.src = tries[i]; else img.replaceWith(document.createRange().createContextualFragment(SVG.app)); };
    img.src = tries[0];
  });
}

async function drawQr(box, o) {
  if (!box) return;
  const alt = `UPI QR code for ${exactRupees(o.amount_paise)}, order ${o.code}`;
  if (o.upi_link) {
    try {
      const QR = (await Promise.race([import("https://esm.sh/qrcode@1.5.4"),
        new Promise((_, r) => setTimeout(() => r(new Error("slow")), 6000))])).default;
      box.innerHTML = `<img alt="${esc(alt)}" src="${await QR.toDataURL(o.upi_link, { margin: 1, width: 440, errorCorrectionLevel: "M" })}">`;
      return;
    } catch { /* fall back to Razorpay's own picture */ }
  }
  if (o.qr_image) { box.innerHTML = `<img alt="${esc(alt)}" src="${esc(o.qr_image)}">`; return; }
  box.textContent = "Couldn't load the QR code. Refresh the page.";
}

function summary({ plan, plans, order, renew }) {
  const price = order ? order.amount_paise : plan?.price_paise;
  const ready = state.cfg.payments_ready;
  return `<aside class="summary${order ? "" : " first"}" aria-labelledby="sum-h"><h2 id="sum-h">Summary</h2>
    ${!order && plans.length > 1 ? `<label for="plan" class="small">Plan</label><select id="plan">${plans.map((p) =>
      `<option value="${esc(p.id)}" ${p.id === plan?.id ? "selected" : ""}>${esc(p.name)} — ${rupees(p.price_paise)}</option>`).join("")}</select>` : ""}
    <div class="line"><span>${esc(state.cfg.product_name)} ${esc(plan?.name || "")}${renew || order?.kind === "renew" ? " renewal" : ""}</span><span>${rupees(plan?.price_paise)}</span></div>
    <div class="line muted"><span>Valid for</span><span>${planLength(plan)}</span></div>
    <div class="line muted"><span>Devices (PC or phone)</span><span>up to ${Number(plan?.max_devices) || 2} at once</span></div>
    ${renew || order?.kind === "renew" ? `<p class="small muted">Continues from your current end date.</p>` : ""}
    ${order ? `<div class="line muted"><span>Order</span><span><code>${esc(order.code)}</code></span></div>` : ""}
    <div class="line total"><span>Total</span><span>${exactRupees(price)}</span></div>
    ${order ? `<button class="btn btn-ghost btn-block btn-sm" id="cancel">Cancel this order</button>`
      : `<button class="btn btn-block btn-lg" id="go" ${ready ? "" : "disabled"}>Pay ${rupees(price)}</button>
         ${ready ? "" : `<p class="hint">Payments open soon.${state.profile?.role === "admin" ? ` Admin: add your Razorpay keys in <a href="#/admin/settings">Settings</a>.` : ""}</p>`}`}
    <p class="err" id="err" role="alert"></p>
    <div class="assure">${SVG.shield}<p>Your key is issued only after the payment gateway confirms the money arrived. No screenshot or UTR needed.</p></div>
  </aside>`;
}

function layout(ctx) {
  const { order } = ctx;
  const m = methodById(ctx.method);
  return `<div class="wrap">
    <div class="page-head slim"><h1>${order ? "Complete your payment" : ctx.renew ? "Renew your licence" : "Checkout"}</h1></div>
    <div class="checkout">
      <section aria-labelledby="pm-h">
        ${state.cfg.test_mode ? `<p class="testmode">Test mode: payments here use Razorpay's test system, no real money moves.</p>` : ""}
        <h2 id="pm-h">Select your payment method:</h2>
        <fieldset class="methods" aria-labelledby="pm-h">
          ${METHODS.map((x) => `<label class="method"><input type="radio" name="pm" value="${x.id}" ${x.id === m.id ? "checked" : ""}>
            <span class="app">${x.file ? `<img data-app="${x.file}" alt="">` : x.icon}</span>
            <span>${esc(x.name)}${x.sub ? `<span class="sub">${esc(x.sub)}</span>` : ""}</span></label>`).join("")}
        </fieldset>
        <div class="paybox" id="paybox" aria-live="polite"></div>
      </section>
      ${summary(ctx)}
    </div></div>`;
}

function payboxHtml(ctx) {
  const { order: o, plan } = ctx;
  const m = methodById(ctx.method);
  const amt = rupees(o ? o.amount_paise : plan?.price_paise);
  if (!o) {
    return `<div class="qr-area"><div class="qr placeholder" aria-hidden="true"></div>
      <div><h3>${m.id === "qr" ? "Your QR code appears here" : `Pay with ${esc(m.name)}`}</h3>
        <p>Press <b>Pay ${amt}</b>. We make a QR code just for this order: it works once, for exactly ${amt}.</p>
        <p class="muted small">${isPhone() && m.scheme ? `Then tap the ${esc(m.name)} button and approve the payment in the app.` : "Then scan it with your phone and approve the payment."}</p></div></div>`;
  }
  if (o.status !== "pending") {
    return `<h3>This QR code has closed</h3><p>No money was taken for it. Make a new one whenever you're ready.</p>
      <button class="btn" id="again">Get a new QR code</button>`;
  }
  const link = appLink(m, o.upi_link);
  const phoneApp = isPhone() && m.id !== "qr" && link;
  const steps = m.id === "qr" ? `<ol><li>Open Google Pay, PhonePe, Paytm, BHIM or your bank's app.</li><li>Tap <b>Scan</b> and scan this code.</li><li>Approve <b>${amt}</b>.</li></ol>`
    : `<ol><li>Open ${esc(m.name)} on your phone.</li><li>Tap <b>Scan</b> and scan this code.</li><li>Approve <b>${amt}</b>.</li></ol>`;
  return `${phoneApp ? `<a class="btn btn-lg btn-block" href="${esc(link)}">Open ${esc(m.name)} and pay ${amt}</a>
      <p class="hint center">Approve the payment in the app, then come back to this page.</p>
      <div class="divider">or scan from another phone</div>` : ""}
    <div class="qr-area"><div class="qr" id="qr">Loading QR code…</div>
      <div>${steps}${!link && m.id !== "qr" && isPhone() ? `<p class="hint">Can't open the app from here: take a screenshot and use <b>Scan from gallery</b> in ${esc(m.name)}.</p>` : ""}</div></div>
    <div class="status-line" id="st"><span class="pulse"></span><span>Waiting for your payment. This page updates by itself.</span></div>
    <p class="hint" id="left"></p>`;
}

function mount(ctx) {
  const box = $("#paybox");
  box.innerHTML = payboxHtml(ctx);
  if (ctx.order?.status === "pending") drawQr($("#qr"), ctx.order);
  $("#again")?.addEventListener("click", (e) => busy(e.currentTarget, () => startOrder(ctx), $("#err")));
}

async function startOrder(ctx) {
  const plan_id = $("#plan")?.value || ctx.plan?.id;
  const r = await api("/api/orders", { method: "POST", body: { plan_id, renew_kid: ctx.renew || ctx.order?.renew_kid || undefined } });
  sessionStorage.setItem(`pm:${r.order.id}`, ctx.method);
  location.hash = `#/pay/${r.order.id}`;
}

function wire(ctx) {
  appIcons();
  mount(ctx);
  $$("input[name=pm]").forEach((r) => r.addEventListener("change", () => {
    ctx.method = r.value;
    if (ctx.order) sessionStorage.setItem(`pm:${ctx.order.id}`, r.value);
    mount(ctx);
  }));
  $("#plan")?.addEventListener("change", () => {
    ctx.plan = ctx.plans.find((p) => p.id === $("#plan").value);
    $(".summary .line span:last-child").textContent = rupees(ctx.plan.price_paise);
    $(".summary .line.muted span:last-child").textContent = planLength(ctx.plan);
    $(".summary .total span:last-child").textContent = exactRupees(ctx.plan.price_paise);
    $("#go").textContent = `Pay ${rupees(ctx.plan.price_paise)}`;
    $(".summary .line span").textContent = `${state.cfg.product_name} ${ctx.plan.name}${ctx.renew ? " renewal" : ""}`;
    mount(ctx);
  });
  $("#go")?.addEventListener("click", (e) => busy(e.currentTarget, () => startOrder(ctx), $("#err")));
}

export async function checkout(params) {
  if (needLogin(location.hash)) return;
  title("Checkout", state.cfg.product_name);
  const renew = params.renew || "";
  const { data } = await state.sb.from("plans").select("*").eq("active", true).order("sort");
  const plans = data || [];
  let plan = plans.find((p) => p.id === params.id);
  if (!plan && renew) {
    const { data: l } = await state.sb.from("licences").select("plan_id").eq("kid", renew).maybeSingle();
    plan = plans.find((p) => p.id === l?.plan_id);
  }
  plan = plan || plans.find((p) => p.badge === "Popular") || plans[0];
  if (!plan) { render(`<div class="wrap"><div class="panel narrow"><h2>No plans yet</h2><p>Please check back soon.</p></div></div>`); return; }
  const ctx = { plan, plans, order: null, renew, method: isPhone() ? "gpay" : "qr" };
  render(layout(ctx));
  wire(ctx);
}

// ------------------------------------------------------------------ the payment page (#/pay/<order id>)
let live = null;
export async function pay(params) {
  if (needLogin(location.hash)) return;
  title("Payment", state.cfg.product_name);
  const d = await api(`/api/orders/${params.id}`);
  const o = d.order;
  if (o.status === "paid") return showKey(d);
  const [{ data: plan }, { data: plans }] = await Promise.all([
    state.sb.from("plans").select("*").eq("id", o.plan_id).maybeSingle(),
    state.sb.from("plans").select("*").eq("active", true).order("sort")]);
  const ctx = { plan, plans: plans || [], order: o, renew: o.renew_kid || "",
                method: sessionStorage.getItem(`pm:${o.id}`) || (isPhone() ? "gpay" : "qr") };
  render(layout(ctx));
  wire(ctx);
  $("#cancel").addEventListener("click", (e) => {
    if (!confirm("Cancel this order? Don't cancel if you have just paid.")) return;
    busy(e.currentTarget, async () => {
      const r = await api(`/api/orders/${o.id}`, { method: "POST", body: { action: "cancel" } });
      if (r.order.status === "paid") return pay({ id: o.id });      // it was paid a moment ago
      location.hash = "#/pricing";
    });
  });
  if (o.status !== "pending") return;
  const ends = Date.parse(o.expires_at);
  const tick = setInterval(() => {
    const el = $("#left");
    if (!document.body.contains(el)) { if (!location.hash.includes(o.id)) clearInterval(tick); return; }
    const s = Math.max(0, Math.round((ends - Date.now()) / 1000));
    el.textContent = s ? `This QR code closes in ${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}.`
      : "This QR code has closed for new payments. If you already paid, keep this page open: it still counts.";
  }, 1000);
  watch(o.id, ctx);
}

function watch(id, ctx) {
  if (live) { state.sb.removeChannel(live); live = null; }
  let done = false, busyCheck = false;
  const stop = () => { done = true; if (live) { state.sb.removeChannel(live); live = null; } };
  const check = async () => {
    if (done || busyCheck) return;
    if (!location.hash.includes(id)) return stop();
    busyCheck = true;
    try {
      const d = await api(`/api/orders/${id}`);      // the server asks Razorpay - the browser can't fake "paid"
      if (d.order.status === "paid") { stop(); showKey(d); }
      else if (d.order.status !== "pending") { stop(); ctx.order = d.order; mount(ctx); }
    } catch { /* a missed check is fine, the next one runs in 3 s */ }
    finally { busyCheck = false; }
  };
  live = state.sb.channel(`order-${id}`).on("postgres_changes",
    { event: "UPDATE", schema: "public", table: "orders", filter: `id=eq.${id}` },
    (p) => { if (p.new?.status !== "pending") setTimeout(check, 100); }).subscribe();
  const poll = setInterval(() => { if (done) return clearInterval(poll); check(); }, 3000);
  document.addEventListener("visibilitychange", () => { if (!document.hidden) check(); });   // back from the UPI app
}

function showKey(d) {
  const { order: o, licence: l } = d;
  render(`<div class="wrap"><div class="panel success" style="max-width:720px;margin:56px auto 0">
    <div class="big-check">${SVG.check}</div>
    <h1 style="font-size:2rem">Payment confirmed</h1>
    <p>Order <code>${esc(o.code)}</code>, ${exactRupees(o.amount_paise)}${o.utr ? `, UPI reference ${esc(o.utr)}` : ""}.</p>
    ${l ? `<label>Your licence key</label><div class="keybox" id="key">${esc(l.key)}</div>
      <div class="row" style="margin-top:16px"><button class="btn" id="cp">Copy key</button>
        <a class="btn btn-ghost" href="/api/download">Download installer</a>
        <a class="btn btn-ghost" href="#/invoice/${o.id}">Invoice</a></div>
      ${l.enabled ? "" : `<p class="warn">Your key will be switched on by the admin shortly.</p>`}
      <p class="muted" style="margin-top:16px">Paste it while installing, with the internet on. It's also saved under <a href="#/account">My licences</a>.</p>`
      : `<p>Your key is being prepared. Open <a href="#/account">My licences</a> in a moment.</p>`}
  </div></div>`);
  $("#cp")?.addEventListener("click", () => copy(l.key, "Licence key copied"));
}

// ------------------------------------------------------------------ invoice
export async function invoice(params) {
  if (needLogin(location.hash)) return;
  const { data: o } = await state.sb.from("orders").select("*, plans(name, duration_days)").eq("id", params.id).maybeSingle();
  const { data: s } = await state.sb.from("site_settings").select("*").eq("id", 1).maybeSingle();
  if (!o || o.status !== "paid") { render(`<div class="wrap"><p class="err">No paid order with this id.</p></div>`); return; }
  const { data: buyer } = await state.sb.from("profiles").select("username,email,full_name").eq("id", o.user_id).maybeSingle();
  title(`Invoice ${o.invoice_no || o.code}`, state.cfg.product_name);
  render(`<div class="invoice">
    <div class="row" style="justify-content:space-between;align-items:flex-start">
      <div><h1>Invoice</h1><p>${esc(o.invoice_no || o.code)}<br>Date: ${day(o.paid_at)}</p></div>
      <div style="text-align:right"><b>${esc(s?.business_name || s?.product_name || state.cfg.product_name)}</b><br>
        ${esc(s?.business_address || "").replace(/\n/g, "<br>")}${s?.gstin ? `<br>GSTIN ${esc(s.gstin)}` : ""}
        ${s?.support_email ? `<br>${esc(s.support_email)}` : ""}</div>
    </div>
    <p><b>Billed to</b><br>${esc(buyer?.full_name || buyer?.username || "")}<br>${esc(buyer?.email || "")}</p>
    <table><thead><tr><th>Item</th><th>Order</th><th style="text-align:right">Amount</th></tr></thead><tbody>
      <tr><td>${esc(state.cfg.product_name)} licence — ${esc(o.plans?.name || o.plan_id)}${o.kind === "renew" ? " (renewal)" : ""}</td>
        <td>${esc(o.code)}</td><td style="text-align:right">${exactRupees(o.amount_paise)}</td></tr></tbody></table>
    <p class="total">Total paid ${exactRupees(o.amount_paise)}</p>
    <p>Paid by UPI${o.payer ? ` from ${esc(o.payer)}` : ""}${o.utr ? `, reference ${esc(o.utr)}` : ""}, on ${when(o.paid_at)}.</p>
    <div class="row no-print" style="margin-top:24px"><button class="btn" onclick="print()">Print or save as PDF</button>
      <a class="btn btn-ghost" href="#/account">Back</a></div>
  </div>`);
}
