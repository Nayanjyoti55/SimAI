-- =====================================================================================================
--  S.I.M website - database (Supabase).  Supabase dashboard > SQL editor > New query > paste all > Run.
--  Safe to run again after an update (everything is "if not exists" / "or replace").
-- =====================================================================================================

create extension if not exists citext;

-- ---------------------------------------------------------------- people
create table if not exists profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  username citext unique,
  email text,
  full_name text,
  phone text,
  role text not null default 'user' check (role in ('user', 'admin')),
  banned boolean not null default false,
  created_at timestamptz not null default now()
);

create or replace function is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists(select 1 from profiles where id = auth.uid() and role = 'admin' and not banned);
$$;

-- a profile is made for every new account (e-mail sign-up or Google)
create or replace function handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  wanted text := nullif(trim(new.raw_user_meta_data->>'username'), '');
begin
  if wanted is not null and exists(select 1 from profiles where username = wanted::citext) then
    wanted := null;                         -- taken: the site asks for another one after sign-in
  end if;
  insert into profiles(id, username, email, full_name)
  values (new.id, wanted, new.email,
          coalesce(new.raw_user_meta_data->>'full_name', new.raw_user_meta_data->>'name'))
  on conflict (id) do nothing;
  return new;
end $$;
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function handle_new_user();

-- ---------------------------------------------------------------- what's for sale / download
create table if not exists plans (
  id text primary key,                       -- e.g. 'month', 'year'
  name text not null,
  duration_days int not null default 30,     -- 0 = lifetime
  price_paise int not null check (price_paise >= 100),
  description text default '',
  badge text default '',
  sort int not null default 0,
  active boolean not null default true
);
insert into plans(id, name, duration_days, price_paise, description, badge, sort) values
  ('month', '1 month', 30, 9900, 'Try every feature for a month.', '', 1),
  ('halfyear', '6 months', 182, 44900, 'A semester with your assistant.', 'Popular', 2),
  ('year', '1 year', 365, 79900, 'Best value for a full year.', 'Best value', 3),
  ('lifetime', 'Lifetime', 0, 199900, 'Pay once, keep it forever.', '', 4)
on conflict (id) do nothing;

create table if not exists releases (
  id bigserial primary key,
  version text not null,
  url text not null,                         -- GitHub release asset / Supabase Storage / any direct link
  file_name text default '',
  size_bytes bigint default 0,
  notes text default '',
  published boolean not null default true,
  downloads int not null default 0,
  platform text not null default 'windows',  -- windows (.exe installer) | android (.apk)
  created_at timestamptz not null default now()
);

create table if not exists site_settings (
  id int primary key default 1 check (id = 1),
  product_name text not null default 'S.I.M',
  tagline text not null default 'Smart Intelligence Matrix - the AI that runs your PC',
  made_by text not null default 'Nayanjyoti',
  powered_by text not null default 'Ulinks',
  support_email text default '',
  payments_enabled boolean not null default true,  -- switch off to pause sales
  payment_window_min int not null default 15,     -- minutes a payment QR stays open
  refund_days int not null default 7,
  auto_issue boolean not null default true,       -- key is given the moment the payment is detected
  installer_check boolean not null default true,  -- installer + app: key must be registered AND enabled
  one_pc_per_key boolean not null default true,   -- a key works on the first PC that activates it
  razorpay_key_id text default '',                -- rzp_test_... while testing, rzp_live_... for real money
  business_name text default '',
  business_address text default '',
  gstin text default '',
  updated_at timestamptz not null default now()
);
insert into site_settings(id) values (1) on conflict (id) do nothing;

-- secrets: no policies at all -> only the website's server functions (service role) can read them
create table if not exists secret_settings (
  id int primary key default 1 check (id = 1),
  razorpay_key_secret text default '',
  razorpay_webhook_secret text default ''
);
insert into secret_settings(id) values (1) on conflict (id) do nothing;

-- ---------------------------------------------------------------- money + licences
create table if not exists orders (
  id uuid primary key default gen_random_uuid(),
  code text unique not null,                 -- short code shown to the buyer, e.g. SIM-7K2Q
  user_id uuid not null references profiles(id) on delete cascade,
  plan_id text references plans(id),
  kind text not null default 'new' check (kind in ('new', 'renew')),
  renew_kid text,
  method text not null default 'upi' check (method in ('upi', 'razorpay', 'manual')),
  base_paise int not null,
  amount_paise int not null,                 -- exactly what the order's QR asks for
  status text not null default 'pending' check (status in ('pending', 'paid', 'expired', 'cancelled')),
  utr text,
  payer text,
  rzp_qr_id text,                            -- the order's own single-use Razorpay UPI QR
  rzp_qr_image text,
  rzp_qr_content text,                       -- the upi://pay link inside that QR
  razorpay_payment_id text,                  -- the payment Razorpay confirmed (one payment -> one order, ever)
  licence_kid text,
  invoice_no text,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  paid_at timestamptz
);
-- upgrading from the first version of this file: add the new columns, drop the phone-message ones
alter table orders add column if not exists rzp_qr_id text;
alter table orders add column if not exists rzp_qr_image text;
alter table orders add column if not exists rzp_qr_content text;
alter table orders drop column if exists razorpay_order_id;
alter table site_settings add column if not exists payments_enabled boolean not null default true;
alter table site_settings add column if not exists refund_days int not null default 7;
alter table site_settings drop column if exists upi_enabled;
alter table site_settings drop column if exists upi_id;
alter table site_settings drop column if exists payee_name;
alter table site_settings drop column if exists razorpay_enabled;
alter table secret_settings drop column if exists payment_webhook_token;
-- v3: Android app + shared AI brain
alter table releases add column if not exists platform text not null default 'windows';
alter table site_settings add column if not exists play_store_url text default '';
alter table site_settings add column if not exists ai_enabled boolean not null default true;
alter table site_settings add column if not exists ai_daily_limit int not null default 300;
alter table site_settings add column if not exists ai_model text default '';
alter table secret_settings add column if not exists groq_api_key text default '';
drop index if exists orders_pending;
drop index if exists orders_utr;
create index if not exists orders_qr on orders(rzp_qr_id);
create unique index if not exists orders_payment on orders(razorpay_payment_id) where razorpay_payment_id is not null;

create table if not exists licences (
  kid text primary key,
  key text not null,
  user_id uuid references profiles(id) on delete set null,
  order_id uuid references orders(id) on delete set null,
  plan_id text,
  for_whom text default '',
  note text default '',
  valid text default '',
  not_before bigint default 0,
  not_after bigint default 0,                -- unix seconds, 0 = none
  duration int default 0,                    -- seconds from first activation, 0 = none
  machine text default '',                   -- PC code the key was made for (optional)
  activated_machine text,                    -- PC that activated it first
  activated_at timestamptz,                  -- first use on any device
  activated_phone text,                      -- phone that activated it first (the same key works on 1 PC + 1 phone)
  phone_activated_at timestamptz,
  last_seen timestamptz,
  enabled boolean not null default true,
  renewed_to text,
  source text not null default 'web',        -- web | sim | admin
  created_at timestamptz not null default now()
);
create index if not exists licences_user on licences(user_id);
alter table licences add column if not exists activated_phone text;       -- upgrading an older database
alter table licences add column if not exists phone_activated_at timestamptz;

-- the shared AI brain: requests per licence per day (no message contents are ever stored)
create table if not exists ai_usage (
  kid text not null,
  day date not null,
  requests int not null default 0,
  last_at timestamptz,
  primary key (kid, day)
);

create table if not exists payment_events (
  id bigserial primary key,
  received_at timestamptz not null default now(),
  source text not null default 'razorpay',   -- razorpay | check | admin-recheck | manual
  raw text,
  sender text,
  amount_paise int,
  utr text,
  payer text,
  order_id uuid references orders(id) on delete set null,
  status text not null default 'unmatched',  -- matched | unmatched | duplicate | ignored
  note text default ''
);

create table if not exists checkins (
  id bigserial primary key,
  kid text, machine text, app_version text, ai_name text, os text,
  unlock_fails int, status text,
  ts timestamptz not null default now()
);

create table if not exists audit_log (
  id bigserial primary key,
  at timestamptz not null default now(),
  actor text, action text, details jsonb default '{}'::jsonb
);

-- ---------------------------------------------------------------- who may see what (row level security)
alter table profiles enable row level security;
alter table plans enable row level security;
alter table releases enable row level security;
alter table site_settings enable row level security;
alter table secret_settings enable row level security;
alter table orders enable row level security;
alter table licences enable row level security;
alter table payment_events enable row level security;
alter table checkins enable row level security;
alter table audit_log enable row level security;
alter table ai_usage enable row level security;

drop policy if exists "own profile" on profiles;
create policy "own profile" on profiles for select using (id = auth.uid() or is_admin());
drop policy if exists "edit own profile" on profiles;
create policy "edit own profile" on profiles for update using (id = auth.uid() or is_admin());
drop policy if exists "admin profiles" on profiles;
create policy "admin profiles" on profiles for delete using (is_admin());
-- people can change their username / name / phone - never their role
revoke update on profiles from authenticated;
grant update (username, full_name, phone) on profiles to authenticated;

drop policy if exists "plans public" on plans;
create policy "plans public" on plans for select using (active or is_admin());
drop policy if exists "plans admin" on plans;
create policy "plans admin" on plans for all using (is_admin()) with check (is_admin());

drop policy if exists "releases public" on releases;
create policy "releases public" on releases for select using (published or is_admin());
drop policy if exists "releases admin" on releases;
create policy "releases admin" on releases for all using (is_admin()) with check (is_admin());

drop policy if exists "settings public" on site_settings;
create policy "settings public" on site_settings for select using (true);
drop policy if exists "settings admin" on site_settings;
create policy "settings admin" on site_settings for update using (is_admin()) with check (is_admin());

drop policy if exists "own orders" on orders;
create policy "own orders" on orders for select using (user_id = auth.uid() or is_admin());
drop policy if exists "admin orders" on orders;
create policy "admin orders" on orders for all using (is_admin()) with check (is_admin());

drop policy if exists "own licences" on licences;
create policy "own licences" on licences for select using (user_id = auth.uid() or is_admin());
drop policy if exists "admin licences" on licences;
create policy "admin licences" on licences for all using (is_admin()) with check (is_admin());

drop policy if exists "admin payments" on payment_events;
create policy "admin payments" on payment_events for all using (is_admin()) with check (is_admin());
drop policy if exists "admin checkins" on checkins;
create policy "admin checkins" on checkins for all using (is_admin()) with check (is_admin());
drop policy if exists "admin ai usage" on ai_usage;
create policy "admin ai usage" on ai_usage for select using (is_admin());
drop policy if exists "admin audit" on audit_log;
create policy "admin audit" on audit_log for select using (is_admin());

-- ---------------------------------------------------------------- live updates (admin dashboard, payment page)
do $$ begin
  begin alter publication supabase_realtime add table orders; exception when others then null; end;
  begin alter publication supabase_realtime add table licences; exception when others then null; end;
  begin alter publication supabase_realtime add table payment_events; exception when others then null; end;
  begin alter publication supabase_realtime add table checkins; exception when others then null; end;
  begin alter publication supabase_realtime add table profiles; exception when others then null; end;
end $$;

-- ---------------------------------------------------------------- downloads counter (anyone)
create or replace function count_download(p_id bigint) returns void
language sql security definer set search_path = public as $$
  update releases set downloads = downloads + 1 where id = p_id and published;
$$;
grant execute on function count_download(bigint) to anon, authenticated;

-- ---------------------------------------------------------------- installer files (Supabase Storage)
insert into storage.buckets(id, name, public) values ('releases', 'releases', true) on conflict (id) do nothing;
drop policy if exists "releases read" on storage.objects;
create policy "releases read" on storage.objects for select using (bucket_id = 'releases');
drop policy if exists "releases write" on storage.objects;
create policy "releases write" on storage.objects for insert with check (bucket_id = 'releases' and is_admin());
drop policy if exists "releases delete" on storage.objects;
create policy "releases delete" on storage.objects for delete using (bucket_id = 'releases' and is_admin());

-- ================================================================ v3.2: devices per licence, security
-- How many devices (PCs + phones together) one key may be used on at the same time. Set per plan; copied onto
-- each key when it's sold, and changeable per key in Admin › Licence keys.
alter table plans add column if not exists max_devices int not null default 2;
alter table licences add column if not exists max_devices int not null default 2;

-- Every device a key is (or was) used on. "active" = holding one of the key's device slots right now.
-- Signing out in SIM, uninstalling it, or "Remove" in My licences frees the slot.
create table if not exists licence_devices (
  kid text not null references licences(kid) on delete cascade,
  device text not null,                      -- one-way device code (never the PC's serial or name)
  platform text not null default 'windows',  -- windows | android
  name text default '',                      -- e.g. "DESKTOP-4F2 (Windows)" - shown only to the key's owner
  first_seen timestamptz not null default now(),
  last_seen timestamptz not null default now(),
  active boolean not null default true,
  released_at timestamptz,
  primary key (kid, device)
);
create index if not exists licence_devices_kid on licence_devices(kid);
alter table licence_devices enable row level security;
drop policy if exists "own devices" on licence_devices;
create policy "own devices" on licence_devices for select
  using (is_admin() or exists (select 1 from licences l where l.kid = licence_devices.kid and l.user_id = auth.uid()));
drop policy if exists "admin devices" on licence_devices;
create policy "admin devices" on licence_devices for all using (is_admin()) with check (is_admin());

-- SIM Shield: threat fingerprints and blocked sites published to every copy of SIM (GET /api/signatures)
create table if not exists security_signatures (
  sha256 text primary key check (sha256 ~ '^[0-9a-f]{64}$'),
  name text not null default '',
  added_at timestamptz not null default now()
);
create table if not exists blocked_domains (
  domain text primary key,
  reason text default '',
  added_at timestamptz not null default now()
);
-- Website protection: addresses that hammer sign-in / licence checks get blocked for a while
create table if not exists ip_hits (
  ip text not null,
  bucket text not null,
  minute bigint not null,
  n int not null default 0,
  primary key (ip, bucket, minute)
);
create table if not exists blocked_ips (
  ip text primary key,
  reason text default '',
  blocked_at timestamptz not null default now(),
  until timestamptz
);
alter table security_signatures enable row level security;
alter table blocked_domains enable row level security;
alter table ip_hits enable row level security;
alter table blocked_ips enable row level security;
drop policy if exists "admin signatures" on security_signatures;
create policy "admin signatures" on security_signatures for all using (is_admin()) with check (is_admin());
drop policy if exists "admin domains" on blocked_domains;
create policy "admin domains" on blocked_domains for all using (is_admin()) with check (is_admin());
drop policy if exists "admin blocked ips" on blocked_ips;
create policy "admin blocked ips" on blocked_ips for all using (is_admin()) with check (is_admin());

-- v3.2: SIM settings kept with the licence (files folder, Google Drive link) so a reinstall reconnects by itself.
-- Never files, passwords or Google tokens.
alter table licences add column if not exists prefs jsonb not null default '{}'::jsonb;
