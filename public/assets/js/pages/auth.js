// Sign in (username or e-mail), sign up, Google, forgotten password, choose a username.
import { api, esc, loadProfile, signInWithGoogle, signInWithUsername, state } from "../api.js";
import { $, busy, render, title, toast } from "../ui.js";

const google = () => `<button class="btn btn-google btn-block" id="google" type="button">
  <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true"><path fill="#EA4335" d="M24 9.5c3.5 0 6.6 1.2 9.1 3.6l6.8-6.8C35.8 2.4 30.3 0 24 0 14.6 0 6.6 5.4 2.6 13.3l7.9 6.2C12.4 13.7 17.7 9.5 24 9.5z"/><path fill="#4285F4" d="M46.5 24.5c0-1.6-.1-3.1-.4-4.5H24v9h12.7c-.6 3-2.3 5.5-4.8 7.2l7.5 5.8c4.4-4 7.1-10 7.1-17.5z"/><path fill="#FBBC05" d="M10.5 28.6A14.5 14.5 0 0 1 9.5 24c0-1.6.3-3.2.8-4.6l-7.9-6.2A24 24 0 0 0 0 24c0 3.9.9 7.5 2.6 10.8l7.9-6.2z"/><path fill="#34A853" d="M24 48c6.5 0 11.9-2.1 15.9-5.8l-7.5-5.8c-2.1 1.4-4.8 2.3-8.4 2.3-6.3 0-11.6-4.2-13.5-10l-7.9 6.2C6.6 42.6 14.6 48 24 48z"/></svg>
  Continue with Google</button>`;

function bindGoogle(next) {
  $("#google")?.addEventListener("click", (e) => busy(e.currentTarget, () => signInWithGoogle(next), $("#err")));
}

export function afterLogin(fallback = "#/account") {
  const next = sessionStorage.getItem("after_login") || fallback;
  sessionStorage.removeItem("after_login");
  if (state.profile && !state.profile.username) { location.hash = "#/choose-username"; return; }
  location.hash = next;
}

export function login(params) {
  title("Sign in", state.cfg.product_name);
  if (params.next) sessionStorage.setItem("after_login", params.next);
  render(`<div class="wrap"><div class="panel narrow">
    <h1 style="font-size:2.2rem">Sign in</h1>
    <p class="muted">To buy or renew a licence and see your keys.</p>
    ${google()}
    <div class="divider">or</div>
    <form id="f" novalidate>
      <label for="u">Username or e-mail</label><input id="u" autocomplete="username" required>
      <label for="p">Password</label><input id="p" type="password" autocomplete="current-password" required>
      <p class="err" id="err" role="alert"></p>
      <button class="btn btn-block" id="go">Sign in</button>
    </form>
    <p style="margin-top:16px"><a href="#/forgot">Forgot your password?</a> · New here? <a href="#/signup">Create an account</a></p>
  </div></div>`);
  bindGoogle(sessionStorage.getItem("after_login") || "#/account");
  $("#f").addEventListener("submit", (e) => {
    e.preventDefault();
    busy($("#go"), async () => {
      await signInWithUsername($("#u").value.trim(), $("#p").value);
      toast(`Signed in as ${state.profile?.username || "you"}.`);
      afterLogin(state.profile?.role === "admin" ? "#/admin" : "#/account");
    }, $("#err"));
  });
}

export function signup() {
  title("Create an account", state.cfg.product_name);
  render(`<div class="wrap"><div class="panel narrow">
    <h1 style="font-size:2.2rem">Create an account</h1>
    <p class="muted">Your licences, renewals and invoices live here.</p>
    ${google()}
    <div class="divider">or with a username</div>
    <form id="f" novalidate>
      <label for="u">Username</label><input id="u" autocomplete="username" maxlength="20" required>
      <p class="hint" id="uhint">3–20 letters, numbers, _ or . (starts with a letter)</p>
      <label for="e">E-mail</label><input id="e" type="email" autocomplete="email" required>
      <label for="p">Password</label><input id="p" type="password" autocomplete="new-password" minlength="8" required>
      <p class="hint">At least 8 characters.</p>
      <p class="err" id="err" role="alert"></p>
      <button class="btn btn-block" id="go">Create account</button>
    </form>
    <p style="margin-top:16px">Already have one? <a href="#/login">Sign in</a></p>
  </div></div>`);
  bindGoogle("#/account");
  let t;
  $("#u").addEventListener("input", () => {
    clearTimeout(t);
    t = setTimeout(async () => {
      const u = $("#u").value.trim();
      if (!u) return;
      const r = await api("/api/username-check", { method: "POST", body: { username: u } }).catch(() => null);
      $("#uhint").textContent = r ? (r.ok ? "✓ Available" : r.why) : "";
      $("#uhint").className = "hint " + (r?.ok ? "ok" : "danger");
    }, 350);
  });
  $("#f").addEventListener("submit", (e) => {
    e.preventDefault();
    busy($("#go"), async () => {
      const username = $("#u").value.trim(), email = $("#e").value.trim(), password = $("#p").value;
      const chk = await api("/api/username-check", { method: "POST", body: { username } });
      if (!chk.ok) throw new Error(chk.why);
      if (password.length < 8) throw new Error("The password needs at least 8 characters.");
      const { data, error } = await state.sb.auth.signUp({ email, password, options: { data: { username },
        emailRedirectTo: `${location.origin}/` } });
      if (error) throw error;
      if (!data.session) {
        render(`<div class="wrap"><div class="panel narrow"><h1 style="font-size:2.2rem">Check your e-mail</h1>
          <p>We sent a link to <b>${esc(email)}</b>. Open it to confirm your account, then sign in.</p>
          <a class="btn" href="#/login">Go to sign in</a></div></div>`);
        return;
      }
      await loadProfile();
      toast("Account created.");
      afterLogin();
    }, $("#err"));
  });
}

export function forgot() {
  title("Reset password", state.cfg.product_name);
  render(`<div class="wrap"><div class="panel narrow">
    <h1 style="font-size:2.2rem">Reset your password</h1>
    <form id="f"><label for="e">Your account's e-mail</label><input id="e" type="email" required>
      <p class="err" id="err" role="alert"></p><button class="btn btn-block" id="go">Send reset link</button></form>
  </div></div>`);
  $("#f").addEventListener("submit", (e) => {
    e.preventDefault();
    busy($("#go"), async () => {
      const { error } = await state.sb.auth.resetPasswordForEmail($("#e").value.trim(), { redirectTo: `${location.origin}/#/new-password` });
      if (error) throw error;
      $("#err").className = "ok";
      $("#err").textContent = "If that e-mail has an account, a reset link is on its way.";
    }, $("#err"));
  });
}

export function newPassword() {
  title("New password", state.cfg.product_name);
  if (!state.session) { location.hash = "#/login"; return; }
  render(`<div class="wrap"><div class="panel narrow">
    <h1 style="font-size:2.2rem">Choose a new password</h1>
    <form id="f"><label for="p">New password</label><input id="p" type="password" minlength="8" autocomplete="new-password" required>
      <p class="err" id="err" role="alert"></p><button class="btn btn-block" id="go">Save password</button></form>
  </div></div>`);
  $("#f").addEventListener("submit", (e) => {
    e.preventDefault();
    busy($("#go"), async () => {
      if ($("#p").value.length < 8) throw new Error("At least 8 characters.");
      const { error } = await state.sb.auth.updateUser({ password: $("#p").value });
      if (error) throw error;
      toast("Password saved.");
      location.hash = "#/account";
    }, $("#err"));
  });
}

/** after Google sign-in: pick a username (and optionally a password, to sign in without Google) */
export function chooseUsername() {
  title("Choose a username", state.cfg.product_name);
  if (!state.session) { location.hash = "#/login"; return; }
  render(`<div class="wrap"><div class="panel narrow">
    <h1 style="font-size:2.2rem">One more step</h1>
    <p class="muted">Choose a username. Add a password too if you'd like to sign in without Google.</p>
    <form id="f">
      <label for="u">Username</label><input id="u" maxlength="20" value="${esc(state.profile?.username || "")}" required>
      <label for="p">Password (optional)</label><input id="p" type="password" autocomplete="new-password" minlength="8">
      <p class="err" id="err" role="alert"></p>
      <button class="btn btn-block" id="go">Continue</button>
    </form></div></div>`);
  $("#f").addEventListener("submit", (e) => {
    e.preventDefault();
    busy($("#go"), async () => {
      const username = $("#u").value.trim();
      if (username.toLowerCase() !== String(state.profile?.username || "").toLowerCase()) {
        const chk = await api("/api/username-check", { method: "POST", body: { username } });
        if (!chk.ok) throw new Error(chk.why);
      }
      const { error } = await state.sb.from("profiles").update({ username }).eq("id", state.session.user.id);
      if (error) throw error;
      const pw = $("#p").value;
      if (pw) {
        if (pw.length < 8) throw new Error("The password needs at least 8 characters.");
        const r = await state.sb.auth.updateUser({ password: pw });
        if (r.error) throw r.error;
      }
      await loadProfile();
      afterLogin();
    }, $("#err"));
  });
}
