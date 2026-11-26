// The website: a small hash router (#/download, #/pricing, #/account, #/admin/...).
import { boot, esc, isAdmin, state } from "./api.js";
import { $, render } from "./ui.js";
import * as pub from "./pages/public.js";
import * as auth from "./pages/auth.js";
import * as acc from "./pages/account.js";
import { admin } from "./pages/admin.js";

const ROUTES = [
  [/^\/?$/, pub.home], [/^\/#?faq$/, pub.home], [/^\/download$/, pub.download], [/^\/pricing$/, pub.pricing],
  [/^\/terms$/, pub.terms], [/^\/privacy$/, pub.privacy], [/^\/contact$/, pub.contact], [/^\/help$/, pub.help], [/^\/login$/, auth.login], [/^\/signup$/, auth.signup], [/^\/forgot$/, auth.forgot],
  [/^\/new-password$/, auth.newPassword], [/^\/choose-username$/, auth.chooseUsername],
  [/^\/account$/, acc.account], [/^\/buy\/(?<id>[\w-]+)$/, acc.checkout], [/^\/pay\/(?<id>[\w-]+)$/, acc.pay],
  [/^\/invoice\/(?<id>[\w-]+)$/, acc.invoice], [/^\/admin(?:\/(?<tab>\w+))?$/, admin],
];

let routeId = 0;
const problem = (h, msg) => `<div class="wrap"><div class="panel narrow center"><h2>${esc(h)}</h2><p>${esc(msg)}</p>
  <div class="row center"><button class="btn" onclick="location.reload()">Try again</button><a class="btn btn-ghost" href="#/">Home</a></div></div></div>`;

function parse() {
  const raw = decodeURIComponent(location.hash.replace(/^#/, "")) || "/";
  const [path, query = ""] = raw.split("?");
  return { path: path.replace(/\/+$/, "") || "/", params: Object.fromEntries(new URLSearchParams(query)) };
}

async function route() {
  const { path, params } = parse();
  for (const [rx, page] of ROUTES) {
    const m = path.match(rx);
    if (m) {
      document.querySelectorAll(".nav a").forEach((a) => a.toggleAttribute("aria-current", a.getAttribute("href") === `#${path}`));
      $("#nav")?.classList.remove("open");
      const mine = ++routeId;
      const slow = setTimeout(() => {           // never leave someone looking at a frozen page
        if (mine !== routeId) return;
        render(problem("This is taking longer than usual", "The connection seems slow. Try again — nothing you did is lost."));
      }, 15000);
      try { await page({ ...params, ...(m.groups || {}) }); }
      catch (e) { console.error(e); if (mine === routeId) render(problem("Something went wrong", e.message)); }
      finally { clearTimeout(slow); }
      return;
    }
  }
  render(`<div class="wrap"><div class="panel narrow"><h2>Page not found</h2><p>That address doesn't exist here.</p><a class="btn" href="#/">Go home</a></div></div>`);
}

function header() {
  const box = $("#nav-auth");
  if (!state.session) { box.innerHTML = `<a href="#/login">Sign in</a><a href="#/pricing" class="btn btn-sm">Get ${esc(state.cfg?.product_name || "S.I.M")}</a>`; return; }
  box.innerHTML = `${isAdmin() ? `<a href="#/admin">Admin</a>` : ""}<a href="#/account" class="btn btn-ghost btn-sm">${esc(state.profile?.username || "My account")}</a>`;
}

function brand() {
  const c = state.cfg || {};
  document.querySelectorAll("[data-year]").forEach((e) => { e.textContent = new Date().getFullYear(); });
  document.querySelectorAll("[data-tagline]").forEach((e) => { e.textContent = c.tagline || ""; });
  document.querySelectorAll("[data-product]").forEach((e) => { e.textContent = c.product_name || "S.I.M"; });
  document.querySelectorAll("[data-made-by]").forEach((e) => { e.textContent = c.made_by || "Nayanjyoti"; });
  document.querySelectorAll("[data-powered-by]").forEach((e) => { e.textContent = c.powered_by || "Ulinks"; });
}

async function start() {
  $(".menu-btn")?.addEventListener("click", (e) => {
    const open = $("#nav").classList.toggle("open");
    e.currentTarget.setAttribute("aria-expanded", String(open));
  });
  try {
    await boot();
  } catch (e) {
    render(problem("Couldn't reach the website", e.message));
    return;
  }
  brand();
  document.addEventListener("brand-changed", brand);
  header();
  if (location.search.includes("code=")) history.replaceState(null, "", location.pathname + location.hash);   // Google sign-in finished
  document.addEventListener("auth-changed", (ev) => {
    header();
    if (ev.detail === "PASSWORD_RECOVERY") location.hash = "#/new-password";
    else if (ev.detail === "SIGNED_IN" && sessionStorage.getItem("after_login")) auth.afterLogin();
  });
  window.addEventListener("hashchange", route);
  if (state.session && sessionStorage.getItem("after_login")) auth.afterLogin();
  await route();
}

start();
