# S.I.M website: download, licence keys, payments, admin

This is the website for your AI. It lets people:

- download the installer, with no sign-up needed;
- create an account with a username and password, or with Google;
- buy or renew a licence key with a UPI QR code, Google Pay, PhonePe, Paytm or any UPI app;
- get the key on screen as soon as the payment is **confirmed by Razorpay**: never before, and never from a screenshot;
- see their keys, renewals and invoices.

You, the admin, get a live dashboard: orders, payments, keys, people, check-ins, prices, installers and settings,
including the **Made by** and **Powered by** names at the bottom left of every page.

It is also the licence server for the app:

- The installer asks the website whether a key is real and switched on.
- Installed copies check their key every ~10 minutes, so keys you switch off or delete stop working.
- Your own S.I.M syncs its keys with the website in both directions.

It's built on GitHub, Netlify, Supabase and Razorpay. There's no build step and nothing to `npm install`.

```
public/              the website (HTML, CSS, JS)
netlify/functions/   the server parts: sign-in, orders, Razorpay, licence checks, admin
supabase/schema.sql  the database: run it in Supabase (again after every update - it's safe to re-run)
scripts/create-admin.mjs   makes your admin account (Deadeye)
tests/run.mjs        npm test: buying -> Razorpay confirms -> key -> installer check, with a pretend Razorpay
```

**The order to set things up:** Supabase (step 1) -> localhost (2) -> Razorpay (3) -> GitHub (4) -> Netlify (5) ->
connect S.I.M (6). Doing localhost first means you find mistakes on your own laptop, not in front of buyers.

---

## New in this version (v3)

- **Shared AI brain** - copies you export and the Android app use YOUR Groq key through this website
  (`/api/ai/v1`). The key stays on the server; each licence has a daily limit; a blocked or expired key stops
  getting answers. Set it up in step 6b.
- **Android** - the Download page has an Android section (APK + your Google Play link). One licence key works
  on one PC **and** one phone; admin can "Free phone" like "Free PC".
- **Upgrading:** run `supabase/schema.sql` again in the SQL editor (it adds the new columns and tables and keeps
  your data), then push to GitHub as usual.

## How a payment works (and why the key can't be given early)

1. The buyer picks a plan and a method (QR, Google Pay, PhonePe, Paytm, other UPI app) and presses **Pay**.
2. The website asks Razorpay for a **new UPI QR code for this order only**: exactly the plan's price, usable once,
   closing after 15 minutes (you can change this in Settings).
3. On a computer the buyer scans it. On a phone, the Google Pay / PhonePe / Paytm button opens that app with the
   payment filled in.
4. Every 3 seconds the payment page asks **your server**, and your server asks **Razorpay's servers**:
   "has this QR received a payment?" Razorpay also calls your website the moment it happens (the webhook).
5. A key is made only when Razorpay reports a payment that is **captured** (money received), on **this order's QR**,
   for **exactly this amount**, with a payment id never used for another order. The buyer's browser can't fake
   any of this: it never decides "paid", and the database doesn't let ordinary users change orders.
6. The money goes to Razorpay, and Razorpay pays it into **your bank account** (normally the next working day or two).

Nothing depends on your phone, its network, or an SMS arriving.

**Can the website check my bank account directly instead?** No. Indian banks don't offer a public API for personal
accounts. The official route (the Account Aggregator system) is only open to RBI-licensed companies. Logging in to
your net banking from a website would mean storing your banking password on a server, which is unsafe and against
your bank's terms. A payment gateway is the proper way: Razorpay is licensed to see the payment and tells your
website, and the money still lands in your own bank account.

## 1. Supabase (the database and sign-in)

1. Go to **supabase.com**, create a project, and choose the Mumbai region (closest to your buyers).
2. Open **SQL editor**, choose **New query**, paste all of `supabase/schema.sql`, and click **Run**.
   - Already ran the older version? Run the new file again. It adds the new payment columns and removes the
     phone-message ones; your plans, users, orders and keys stay.
3. Open **Project Settings -> API** and copy three values: the **Project URL**, the **anon public** key and the
   **service_role** key.
   - The service_role key is a master key. Keep it secret, and never put it in GitHub or in the app.
4. Open **Authentication -> URL Configuration**:
   - Set **Site URL** to `http://localhost:8888` for now. You change it to your Netlify address in step 5.
   - Under **Redirect URLs**, add `http://localhost:8888/**`. You add the Netlify one in step 5.
5. Google sign-in, under **Authentication -> Providers -> Google**:
   1. In console.cloud.google.com, open **APIs & Services -> Credentials -> Create credentials -> OAuth client ID**.
   2. Choose **Web application**.
   3. Under **Authorised redirect URIs**, add the callback URL Supabase shows (`https://xxxx.supabase.co/auth/v1/callback`).
   4. Paste the client ID and secret back into Supabase and switch the provider on.
6. E-mail sign-ups: keep **Confirm email** on under **Authentication -> Providers -> Email**.

## 2. Run it on your laptop first (localhost)

You need Node 18 or newer.

```
npm install -g netlify-cli
copy .env.example .env        (Windows; on Mac/Linux: cp .env.example .env)
```

Fill in `.env` (Notepad is fine):
- `SUPABASE_URL`, `SUPABASE_ANON_KEY` and `SUPABASE_SERVICE_ROLE_KEY` from step 1.
- `LICENCE_SIGNING_KEY` from the S.I.M app: **LICENSES -> CONNECT TO MY WEBSITE -> COPY SIGNING KEY**.
  The app asks for your password first. It's 64 characters (0-9, a-f).

```
npm run create-admin          -> username: Deadeye, then your e-mail and password (typed, never saved to a file)
npm run dev                   -> opens http://localhost:8888
npm test                      -> the payment tests (no internet needed)
```

Sign in with **Deadeye** and your password. You'll see **Admin** in the menu. Open **Admin -> Settings** and fill in
the website name, **Made by**, **Powered by** and your support e-mail. They change on every page as soon as you save.

> **Why the password isn't in the code:** this folder goes to GitHub. A password written in a file there can be read
> by anyone who sees the repository. `create-admin` sends it straight to Supabase instead.

## 3. Razorpay (confirms every payment, pays you into your bank)

You don't need a company. Razorpay accepts individuals ("Unregistered" / "Individual" business type) with your
**PAN** and a **bank account in your name**.

1. Sign up at **razorpay.com** with your e-mail and phone. You start in **Test Mode** straight away.
2. Complete **Account activation (KYC)**: business type **Individual**, your PAN, your bank account (Razorpay checks it
   with a small deposit), and your website address. Razorpay's reviewers look for these pages, which the site already
   has: **Terms and refunds** (`/#/terms`), **Privacy** (`/#/privacy`) and **Contact** (`/#/contact`). Put a real
   support e-mail in Admin -> Settings before applying. Approval usually takes a few working days.
3. **Turn on UPI QR codes.** In the Razorpay dashboard look for **QR Codes** (under Payment Products). If it isn't
   there, write to Razorpay support: *"Please enable UPI QR Codes on my account, and the `qr_image_content` feature
   so the API returns the UPI link."* Without that second feature the QR still works, but the Google Pay / PhonePe /
   Paytm buttons on phones can't open the apps (buyers then scan or use "scan from gallery").
4. **API keys:** **Account & Settings -> API Keys -> Generate key**. You get a **Key Id** (`rzp_test_...` or
   `rzp_live_...`) and a **Key Secret** (shown once - copy it).
5. Put them in the website: **Admin -> Settings -> Razorpay**: Key id and Key secret, then **Save settings**.
   The secret is stored in a database table no browser can read.
6. **Webhook** (makes the key appear instantly; without it the page still finds the payment within seconds):
   1. In Admin -> Settings click **make one for me** next to Webhook secret, and copy it.
   2. Razorpay: **Account & Settings -> Webhooks -> Add new webhook**.
   3. URL: `https://YOUR-SITE.netlify.app/api/razorpay/webhook` (Razorpay can't reach `localhost`; add this after step 5).
   4. Secret: the one you copied. Events: tick **qr_code.credited** and **payment.captured**. Save.
7. **Admin -> Payments -> Test my Razorpay keys** should say "keys work".

**Test mode vs live mode:** test keys (`rzp_test_`) never move real money, and real UPI apps can't pay a test QR.
Use test mode to check that QR codes appear and the pages work. To test a real payment end to end, switch to your
live keys and add a temporary ₹1 plan in **Admin -> Plans & prices**, buy it yourself, check the key appears, then
switch the plan off. Webhooks are set up separately for test and live mode in Razorpay, so add it again for live.

Razorpay keeps a small fee from each payment; see their pricing page. The rest is paid into your bank account.

## 4. GitHub (where the code lives)

1. On github.com click **New repository**. Name it e.g. `sim-website`, choose **Private**, and don't add a README.
2. In this folder (Command Prompt / PowerShell):

```
git init
git add .
git commit -m "S.I.M website"
git branch -M main
git remote add origin https://github.com/YOUR-NAME/sim-website.git
git push -u origin main
```

3. Check on GitHub that **there is no `.env` file** in the list. `.gitignore` keeps it out; if you ever see it there,
   delete it from GitHub and make new Supabase keys.
4. Later changes: `git add . && git commit -m "what changed" && git push`. Netlify redeploys by itself.

## 5. Netlify (the live website)

1. On netlify.com: **Add new site -> Import an existing project -> GitHub**, and pick `sim-website`.
2. Leave **Build command** empty and **Publish directory** as `public` (Netlify reads both from `netlify.toml`).
   Click **Deploy**.
3. **Site configuration -> Environment variables -> Add a variable**, four times, with the same values as your `.env`:
   `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `LICENCE_SIGNING_KEY`.
   Tick **Contains secret values** for the last two.
4. **Deploys -> Trigger deploy -> Deploy site**, so the functions pick up the variables.
5. Rename the site under **Site configuration -> Change site name** (e.g. `sim-ai.netlify.app`), or add your own
   domain under **Domain management**.
6. Back in **Supabase -> Authentication -> URL Configuration**: set **Site URL** to the Netlify address and add
   `https://sim-ai.netlify.app/**` to **Redirect URLs** (keep the localhost one for testing).
7. Add the Razorpay webhook now (step 3.6) with the Netlify address.
8. Open the site, sign in as Deadeye, and check **Admin -> Payments**: both ticks should be green.

## 6. Connect your S.I.M app (localhost and Netlify)

The app talks to whichever address you give it.

| Website address in S.I.M | When to use it |
|---|---|
| `http://localhost:8888` | Testing on your own laptop while `npm run dev` is running. Only works on that laptop. |
| `https://sim-ai.netlify.app` | The real thing. Use this for installers you give to other people. |

1. Make sure the website's `LICENCE_SIGNING_KEY` (in `.env` for localhost, in Netlify for live) is the one from
   **LICENSES -> CONNECT TO MY WEBSITE -> COPY SIGNING KEY** on this PC.
2. In the **LICENSES** page fill in **WEBSITE**, **USERNAME** `Deadeye` and your **PASSWORD**, then **SIGN IN**.
3. Click **TEST**. It should say **Website reachable** with no ⚠. A ⚠ means the two signing keys differ: copy it again
   and redeploy (Netlify) or restart `npm run dev` (localhost).
4. Keys now sync both ways: keys you make in the app appear in **Admin -> Licence keys**, keys people buy appear in
   the app marked 🌐, and **BLOCK** / **DELETE** work in both places.
5. **EXPORT INSTALLER**: put the **Netlify** address in **YOUR WEBSITE** and keep **Installer checks the key on my
   website** ticked. The installer then needs the internet and refuses fake, switched-off, deleted or already-used
   keys. **Buy a licence** opens your pricing page.
6. When you move from localhost to Netlify, sign in again in LICENSES with the Netlify address and press **SYNC**.

**If your laptop crashes:** install S.I.M from your own installer, open **PROFILE -> RESTORE MASTER ADMIN** and sign in
with Deadeye and your password. The website gives the signing key back, but only to its admin.

## 6b. The shared AI brain (so buyers don't need their own Groq key)

1. console.groq.com › **API Keys › Create API key**. Copy it (starts with `gsk_`).
2. Website **Admin › Settings › Shared AI brain**: paste it in *Groq API key*, keep *Let licensed copies use the
   shared AI brain* ticked, choose *Requests per licence per day* (one question uses 1–3 requests; 300 is a good
   start). Save. (Alternatively put it in Netlify as the environment variable `GROQ_API_KEY`.)
3. In SIM, **EXPORT INSTALLER**: tick *Give them my AI brain through my website*. The Android app always uses it.

Good to know:
- Groq's limits apply to your whole Groq account, shared by all your users. On the free plan the big model
  allows roughly 1,000 requests a day in total — with more than a handful of daily users, switch Groq to its
  paid Developer plan (console.groq.com › Settings › Billing). When the big model is busy, the website
  automatically answers with the fast model.
- What passes through: the question and the AI's answer (and, from phones, the few seconds of speech after
  "Hey SIM", to be turned into text). Nothing is stored except a request count per licence per day
  (Admin › Settings shows today's total).
- Netlify's free plan has a monthly allowance for function calls; watch *Netlify › Usage* as users grow.

## 7. If something goes wrong

| What you see | What to do |
|---|---|
| "Couldn't reach the website" / page stuck | Fixed in this version (a sign-in deadlock made pages hang until refresh). If it still happens, the page shows **Try again** after 15 s. Check Netlify -> **Logs -> Functions** for errors. |
| "The website isn't connected to its database" | Environment variables missing on Netlify, or not redeployed after adding them (step 5.4). |
| Pay button greyed out, "Payments open soon" | Razorpay key id / secret not saved in Admin -> Settings. |
| "Razorpay: Authentication failed" | Key id and secret don't match, or test id with live secret. Generate a new pair. |
| "Razorpay: ... not enabled" / QR not created | QR Codes isn't enabled on your Razorpay account (step 3.3). |
| QR shows but no app buttons on phones | Ask Razorpay to enable `qr_image_content` (step 3.3). |
| Buyer paid but the page keeps waiting | Admin -> Orders -> **Check payment** asks Razorpay again. If Razorpay shows the payment as captured, the key is issued. If the payment failed, the bank returns the money by itself. |
| Someone paid you in cash / bank transfer | Admin -> Orders -> **Mark paid** (logged with your name), or Licence keys -> Make a key by hand. |
| Google sign-in comes back to the wrong site | Supabase Site URL / Redirect URLs (steps 1.4 and 5.6). |
| S.I.M TEST shows ⚠ | Signing keys differ (step 6.1). |
| Copies say the AI brain isn't set up | Step 6b: save the Groq key in Admin › Settings. |
| "Daily AI limit reached" | Raise *Requests per licence per day* (Admin › Settings). |
| A buyer changed phones: "already used on another phone" | Admin › Licence keys › **Free phone**. |
| Official app icons | The checkout shows a neutral phone icon. To show the real Google Pay / PhonePe / Paytm icons, download them from each company's brand / press page and save them as `public/assets/img/apps/gpay.svg`, `phonepe.svg`, `paytm.svg` (or `.png`). |

## 8. Publishing the installer (Windows) and the Android app

1. Build it in S.I.M with **PROFILE → EXPORT INSTALLER**.
2. Upload the `.exe` to a **GitHub Release**: your repo → **Releases → Draft a new release** → attach the file. It's free, up to 2 GB.
3. Copy the file's download link.
4. Go to **Admin → Installers**, add the version, paste the link and write what's new, then click **Publish**. The Download page and the home page update straight away.

You can also upload small files (under 50 MB on Supabase's free plan) directly in Admin → Installers.

**Android:** SIM's **PROFILE › EXPORT ANDROID APP** builds the .apk and, if you're signed in on the LICENSES page,
puts it on the Download page by itself. By hand: Admin › Installers › *For: Android (.apk app)*. When the app is
on Google Play, paste its link in Admin › Settings › Android app. The full Android + Google Play guide is in the
SIM folder: `android_app/ANDROID_GUIDE.md`.

## 9. What's where

| You want to… | Go to |
|---|---|
| See sales, payments and check-ins live | Admin → Live overview |
| Change prices, add a plan | Admin → Plans & prices |
| Switch a key off, free it for a new PC, extend it, delete it | Admin → Licence keys |
| Make a key for someone who paid cash | Admin → Licence keys → Make a key by hand |
| See confirmed payments, test Razorpay, webhook address | Admin → Payments |
| Change "Made by" / "Powered by", pause sales | Admin → Settings |
| Block or unblock a person | Admin → People |
| Turn off "key must be registered" checking | Admin → Settings → Licence keys |
| Groq key for the shared AI brain, daily limit | Admin → Settings → Shared AI brain |
| Free a key for a new phone | Admin → Licence keys → Free phone |

**Security notes:**
- Only the website's server functions hold the service_role key and the signing key.
- Browsers get the anon key, which Supabase row-level security limits:
  - people see only their own orders and keys;
  - only the admin sees everything.
- Razorpay's key secret and webhook secret live in a table only the server can read.
- The webhook only accepts messages signed with your webhook secret, and even then the server asks Razorpay's API itself before issuing a key.
