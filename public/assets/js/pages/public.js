// Public pages: home, download, pricing, terms.
import { esc, exactRupees, rupees, size, state, day } from "../api.js";
import { $, render, title } from "../ui.js";

const P = () => esc(state.cfg?.product_name || "S.I.M");

async function latestRelease(platform = "windows") {
  const { data } = await state.sb.from("releases").select("*").eq("published", true).eq("platform", platform)
    .order("created_at", { ascending: false }).limit(6);
  return data || [];
}

const ANDROID_SVG = `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><rect x="6" y="2.5" width="12" height="19" rx="2.5"/><path d="M10.5 18.5h3"/></svg>`;

async function plans() {
  const { data } = await state.sb.from("plans").select("*").eq("active", true).order("sort");
  return data || [];
}

// what people say to it, and what happens - the real product, not marketing lines
const LINES = [
  ["Open my Downloads folder", "Opening Downloads. It's in front of everything else now."],
  ["Play mogno 2.0 Assamese mashup on YouTube", "Playing it in my video player."],
  ["Make this photo under 100 KB", "Done: 96 KB, saved next to the original."],
  ["Kal ka timetable batao", "Tomorrow: Power Systems at 9:30, then Machines lab."],
  ["What's Rahul's number?", "Rahul: 98765 43210. Should I message him on WhatsApp?"],
  ["Lock yourself", "Locked. Only your face or your password opens me."],
];

function coreSvg() {
  const ticks = Array.from({ length: 60 }, (_, i) => {
    const a = (i / 60) * Math.PI * 2, r1 = 236, r2 = i % 5 ? 228 : 216;
    return `<line x1="${(260 + r1 * Math.cos(a)).toFixed(1)}" y1="${(260 + r1 * Math.sin(a)).toFixed(1)}" x2="${(260 + r2 * Math.cos(a)).toFixed(1)}" y2="${(260 + r2 * Math.sin(a)).toFixed(1)}"/>`;
  }).join("");
  return `<svg class="core" viewBox="0 0 520 520" role="img" aria-label="The assistant's animated core">
    <defs>
      <radialGradient id="g" cx="50%" cy="58%" r="55%"><stop offset="0" stop-color="#c4b5ff"/>
        <stop offset=".6" stop-color="#6d4aff" stop-opacity=".75"/><stop offset="1" stop-color="#6d4aff" stop-opacity="0"/></radialGradient>
    </defs>
    <g class="core-ring" stroke="#5a4bb0" stroke-width="2">${ticks}</g>
    <g class="core-ring rev" fill="none"><circle cx="260" cy="260" r="196" stroke="#b7a8ff" stroke-opacity=".35" stroke-dasharray="4 10"/>
      <path d="M260 64 A196 196 0 0 1 452 236" stroke="#d9d0ff" stroke-width="3" stroke-linecap="round"/></g>
    <path d="M260 92 L448 418 L72 418 Z" fill="none" stroke="#9c8cff" stroke-opacity=".45" stroke-width="2"/>
    <g class="core-tri"><path d="M260 168 L360 342 L160 342 Z" fill="url(#g)" stroke="#e4ddff" stroke-width="3" stroke-linejoin="round"/>
      <text x="260" y="304" text-anchor="middle" font-family="Inter, sans-serif" font-weight="800" font-size="34"
            fill="#fff" letter-spacing="5">${P().replace(/\./g, "")}</text></g>
  </svg>`;
}

function startCaptions() {
  const you = $("#cap-you"), says = $("#cap-says");
  if (!you) return;
  const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
  let i = 0;
  const show = () => {
    if (!document.body.contains(you)) return;
    const [q, a] = LINES[i++ % LINES.length];
    you.textContent = q;
    if (reduce) { says.textContent = a; setTimeout(show, 5000); return; }
    says.textContent = "";
    let k = 0;
    const type = () => {
      if (!document.body.contains(says)) return;
      says.textContent = a.slice(0, ++k);
      if (k < a.length) setTimeout(type, 28);
      else setTimeout(show, 2600);
    };
    setTimeout(type, 500);
  };
  show();
}

function ticketRows(list, featured = "halfyear") {
  return list.map((p) => `
    <div class="ticket ${p.id === featured || p.badge === "Popular" ? "featured" : ""}">
      <h3>${esc(p.name)}${p.badge ? `<span class="badge">${esc(p.badge)}</span>` : ""}</h3>
      <p class="desc">${esc(p.description || "")}</p>
      <div class="price">${rupees(p.price_paise)}</div>
      <div class="per">${p.duration_days ? `for ${p.duration_days} days${p.duration_days >= 60 ? `, about ${rupees(Math.round(p.price_paise / (p.duration_days / 30)))} a month` : ""}` : "pay once, use forever"}</div>
      <a class="btn ${p.id === featured || p.badge === "Popular" ? "" : "btn-ghost"}" href="#/buy/${encodeURIComponent(p.id)}">Get ${esc(p.name.toLowerCase())}</a>
    </div>`).join("");
}

function releaseMeta(r) {
  return r ? `For Windows 10 and 11, version ${esc(r.version)}${r.size_bytes ? ", " + size(r.size_bytes) : ""}` : "For Windows 10 and 11";
}

const ICON = {
  lock: `<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><rect x="4" y="10" width="16" height="11" rx="2.5"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/></svg>`,
  pc: `<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><rect x="3" y="4" width="18" height="12" rx="2"/><path d="M8 20h8M12 16v4"/></svg>`,
  user: `<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/></svg>`,
};

export async function home() {
  title("", state.cfg.product_name);
  const [rels, list] = await Promise.all([latestRelease(), plans()]);
  const rel = rels[0];
  render(`
  <section class="hero"><div class="wrap">
    <h1>The assistant that takes care of your PC</h1>
    <p class="lede">${P()} listens to you, opens your folders, plays your music, reads your files and locks your
      laptop with your face. Talk to it in English, Hindi or Hinglish.</p>
    <div class="cta">
      <a class="btn btn-lg" href="${rel ? `/api/download?id=${rel.id}` : "#/download"}">Download ${P()}</a>
      <a class="textlink" href="#/download?android">Get it for Android</a>
    </div>
    <p class="meta-line">${releaseMeta(rel)}. Pay with Google Pay, PhonePe, Paytm or any UPI app.</p>
    <div class="banner">
      ${coreSvg()}
      <div class="chat" aria-live="off">
        <p class="label">Say it the way you'd say it to a friend</p>
        <div class="bubble you" id="cap-you"></div>
        <div class="bubble sim" id="cap-says"></div>
      </div>
    </div>
  </div></section>

  <section class="section"><div class="wrap">
    <div class="section-head"><h2>Private by design</h2><p>Your assistant works for you and nobody else.</p></div>
    <div class="features">
      <div class="feature"><div class="ic">${ICON.lock}</div><h3>Face and password lock</h3><p>When you step away it locks the whole screen and opens only for your face or your password.</p></div>
      <div class="feature"><div class="ic">${ICON.pc}</div><h3>Notes stay on your PC</h3><p>Passwords and private notes are kept on your computer and never sent to an online AI.</p></div>
      <div class="feature"><div class="ic">${ICON.user}</div><h3>A fresh copy for every person</h3><p>Every installation starts empty: your name for it, your memory, your settings.</p></div>
    </div>
  </div></section>

  <section class="section"><div class="wrap">
    <div class="section-head"><h2>No menus to learn</h2><p>Ask, and it does the work on your PC, then tells you what it did.</p></div>
    <div class="says-list">
      ${LINES.map(([q, a]) => `<div class="says-item"><q>${esc(q)}</q><p>${esc(a)}</p></div>`).join("")}
    </div>
  </div></section>

  <section class="section"><div class="wrap">
    <div class="section-head"><h2>Up and running in a few minutes</h2></div>
    <ol class="steps">
      <li><h3>Download</h3><p>Get the installer for Windows 10 or 11. No sign-up needed to download.</p></li>
      <li><h3>Buy a key</h3><p>Scan the QR or tap your UPI app. The key appears as soon as the payment is confirmed.</p></li>
      <li><h3>Install and say its name</h3><p>Paste the key while installing, choose a name for your assistant and start talking.</p></li>
    </ol>
  </div></section>

  <section class="section" id="plans"><div class="wrap">
    <div class="section-head"><h2>Choose your plan</h2><p>One key for your PC and your phone. Renewing continues from your old end date, so you never lose days.</p></div>
    <div class="tickets">${ticketRows(list) || `<p class="muted">Plans will appear here soon.</p>`}</div>
  </div></section>

  <section class="section" id="faq"><div class="wrap">
    <div class="section-head"><h2>Questions</h2></div>
    <div class="faq">${faq()}</div>
    <div class="closing"><h2>Ready when you are</h2><p>Download ${P()} now and buy your key whenever you like.</p>
      <a class="btn btn-lg" href="${rel ? `/api/download?id=${rel.id}` : "#/download"}">Download ${P()}</a></div>
  </div></section>`);
  startCaptions();
  if (location.hash.includes("faq")) document.getElementById("faq")?.scrollIntoView();
}

function faq() {
  const qa = [
    ["Do I need a licence to download?", "No. Anyone can download the installer. You need a licence key while installing."],
    ["How do I pay?", "Scan the QR code with Google Pay, PhonePe, Paytm, BHIM or your bank's app — or, on your phone, tap the app's button and approve the payment. Each order gets its own QR for the exact amount."],
    ["How fast do I get my key?", "Within a few seconds of your payment being confirmed. The key is given only after the payment gateway confirms the money arrived — you don't need to send a screenshot or a UTR number."],
    ["I paid but the page still says waiting.", "Keep the page open — UPI confirmations are sometimes a minute late, and a payment made before the QR closed still counts. You can also close the page: the key appears under My licences once it's confirmed. If money left your account and no key appears within an hour, contact us with the order code; if the payment didn't complete, the bank returns the money automatically."],
    ["Can I use one key on my PC and my phone?", "Yes. One key works on one PC and one Android phone at the same time — type the same key in both. To move it to a new PC or phone, ask us to reset it."],
    ["Is there an Android app?", `Yes — download it from the Download page (or Google Play once it's listed). Say “Hey ${P().replace(/\./g, "")}” and it answers even with the screen off.`],
    ["What happens when my licence ends?", "The app asks for a new key. Renew from My licences — the new key continues from your old end date."],
    ["Does it need the internet?", "For the AI brain, web search and music, yes. Your notes, contacts and face lock work on your PC. The installer needs the internet once, to check your key."],
    ["Which Windows versions are supported?", "Windows 10 and Windows 11, 64-bit, with at least 8 GB of RAM."],
  ];
  return qa.map(([q, a]) => `<details><summary>${esc(q)}</summary><p>${esc(a)}</p></details>`).join("");
}

export async function download() {
  title("Download", state.cfg.product_name);
  const [rels, apks] = await Promise.all([latestRelease("windows"), latestRelease("android")]);
  const r = rels[0], a = apks[0], play = state.cfg.play_store_url;
  render(`<div class="wrap">
    <div class="page-head center"><h1>Download ${P()}</h1><p>Free to download. One licence key works on your PC and your phone.</p></div>
    ${r ? `<div class="panel release">
      <div><h2>For Windows, version ${esc(r.version)}</h2>
        <p class="muted">Released ${day(r.created_at)}${r.size_bytes ? ", " + size(r.size_bytes) : ""}. Windows 10 and 11, 64-bit.</p>
        ${r.notes ? `<p class="notes">${esc(r.notes)}</p>` : ""}</div>
      <div><a class="btn" href="/api/download?id=${r.id}">Download installer</a></div>
    </div>` : `<div class="panel"><h2>For Windows</h2><p>The installer hasn't been published yet. Check back shortly.</p></div>`}
    <div class="panel release" id="android">
      <div><h2>For Android${a ? `, version ${esc(a.version)}` : ""}</h2>
        <p class="muted">${a ? `Released ${day(a.created_at)}${a.size_bytes ? ", " + size(a.size_bytes) : ""}. ` : ""}Android 8 or newer. Say “Hey ${P().replace(/\./g, "")}” and it answers, even with the screen off.</p>
        ${a?.notes ? `<p class="notes">${esc(a.notes)}</p>` : ""}</div>
      <div class="row">${play ? `<a class="btn" href="${esc(play)}" rel="noopener">Get it on Google Play</a>` : ""}
        ${a ? `<a class="btn ${play ? "btn-ghost" : ""}" href="/api/download?platform=android">${ANDROID_SVG} Download APK</a>` : (play ? "" : `<span class="muted">Coming soon</span>`)}</div>
    </div>
    <div class="panel"><h3>Before you install</h3>
      <ul><li>Windows: 8 GB RAM or more and about 2 GB free space. Keep the internet on — the installer checks your licence key.</li>
        <li>Windows may show “Windows protected your PC” for new apps: click <b>More info</b> → <b>Run anyway</b>.</li>
        <li>Android APK: your phone asks to allow installing from your browser the first time — tap <b>Settings</b> → <b>Allow from this source</b>, then go back and tap <b>Install</b>.${play ? " Installing from Google Play skips this step." : ""}</li>
        <li>No key yet? <a href="#/pricing">Buy one</a> with Google Pay, PhonePe, Paytm or any UPI app. It takes a minute.</li></ul></div>
    ${rels.length > 1 ? `<div class="panel"><h3>Older Windows versions</h3><table><tbody>${rels.slice(1).map((o) =>
      `<tr><td>Version ${esc(o.version)}</td><td>${day(o.created_at)}</td><td><a href="/api/download?id=${o.id}">Download</a></td></tr>`).join("")}</tbody></table></div>` : ""}
  </div>`);
  if (location.hash.includes("android")) document.getElementById("android")?.scrollIntoView();
}

export async function pricing() {
  title("Pricing", state.cfg.product_name);
  const list = await plans();
  render(`<div class="wrap">
    <div class="page-head center"><h1>Choose your plan</h1>
      <p>One key for your PC and your phone. Pay with Google Pay, PhonePe, Paytm or any UPI app — your key appears as soon as the payment is confirmed.</p></div>
    <div class="tickets">${ticketRows(list) || `<p class="muted">No plans yet.</p>`}</div>
    <p class="muted" style="margin-top:22px">Prices include all features. Renewing continues from your old end date, so you never lose days.</p>
  </div>`);
}

export function terms() {
  title("Terms", state.cfg.product_name);
  render(`<div class="wrap"><div class="page-head"><h1>Terms and refunds</h1></div>
    <div class="panel">
      <p>A licence key lets you use ${P()} on one PC and one phone for the period you bought. Keys are personal: sharing or reselling a key gets it switched off.</p>
      <p>Keys are issued automatically, only after the payment gateway confirms your payment. If money left your account but no key appeared, contact us with your order code and we will issue it or refund you.</p>
      <p>Refunds for an issued key are possible within ${Number(state.cfg.refund_days ?? 7)} days of purchase if the software doesn't run on your PC.</p>
      <p>Installed copies check their licence online and send a small security check-in (licence id, app version, Windows version, a one-way PC code, failed unlock attempts). Your chats, files, contacts, location, camera and screen are never sent.</p>
      ${state.cfg.support_email ? `<p>Contact: <a href="mailto:${esc(state.cfg.support_email)}">${esc(state.cfg.support_email)}</a></p>` : ""}
    </div></div>`);
}

export function help() {
  title("Help", state.cfg.product_name);
  render(`<div class="wrap"><div class="page-head center"><h1>Help</h1><p>Answers to the questions people ask most.</p></div>
    <div class="faq">${faq()}</div>
    ${state.cfg.support_email ? `<div class="closing"><h2>Still stuck?</h2><p>Write to us and include your order code if it's about a payment.</p>
      <a class="btn" href="mailto:${esc(state.cfg.support_email)}">E-mail ${esc(state.cfg.support_email)}</a></div>` : ""}</div>`);
}

export function privacy() {
  title("Privacy", state.cfg.product_name);
  render(`<div class="wrap"><div class="page-head"><h1>Privacy</h1></div>
    <div class="panel">
      <p>The website keeps your account (username, e-mail), your orders and your licence keys. When the assistant uses the shared AI
        brain, your question passes through this website to Groq to be answered; we count requests per licence but never store what you asked.</p>
      <p> Payments are handled by Razorpay; we receive the
        payment's reference number and the UPI ID it came from, never your bank or card details.</p>
      <p>Installed copies check their licence online and send a small security check-in: licence id, app version, Windows version, a one-way
        PC code and the number of failed unlock attempts. Your chats, files, contacts, location, camera and screen are never sent.</p>
      <p>You can ask us to delete your account at any time.</p>
    </div></div>`);
}

export function contact() {
  title("Contact", state.cfg.product_name);
  const m = state.cfg.support_email;
  render(`<div class="wrap"><div class="panel narrow center"><h1>Contact</h1>
    ${m ? `<p>Write to us at <a href="mailto:${esc(m)}">${esc(m)}</a>. For payments, include your order code.</p>` : `<p>Contact details will be added soon.</p>`}
    <a class="btn btn-ghost" href="#/help">Read the help page</a></div></div>`);
}

export { plans, latestRelease, exactRupees };
