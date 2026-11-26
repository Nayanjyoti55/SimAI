// Small interface helpers.
export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

let toastTimer;
export function toast(msg, bad = false) {
  const t = document.getElementById("toast");
  t.textContent = msg;
  t.classList.toggle("bad", !!bad);
  t.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove("show"), bad ? 6000 : 3200);
}

export async function copy(text, what = "Copied") {
  try { await navigator.clipboard.writeText(text); toast(`${what} to the clipboard.`); }
  catch { toast("Couldn't copy - select the text and press Ctrl+C.", true); }
}

export function render(html) {
  const app = document.getElementById("app");
  app.innerHTML = html;
  app.focus({ preventScroll: true });
  window.scrollTo(0, 0);
  return app;
}

export function title(t, product) { document.title = t ? `${t} · ${product}` : `${product} — the AI assistant that runs your PC`; }

/** run an async action from a button: disables it, shows errors next to it */
export async function busy(btn, fn, errEl) {
  const label = btn?.textContent;
  if (btn) { btn.disabled = true; btn.textContent = "Working…"; }
  if (errEl) errEl.textContent = "";
  try { return await fn(); }
  catch (e) { (errEl ? (errEl.textContent = e.message) : toast(e.message, true)); return undefined; }
  finally { if (btn) { btn.disabled = false; btn.textContent = label; } }
}

export const isPhone = () => /android|iphone|ipad|mobile/i.test(navigator.userAgent);
