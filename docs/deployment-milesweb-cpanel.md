# Deployment Runbook — Tithi IVF on MilesWeb cPanel (Max plan) + GoDaddy DNS

> Step-by-step deploy of the Tithi IVF stack (React frontend + Express backend + MySQL) onto the MilesWeb **Max** hosting account, mapped to `tithihospital.com` via GoDaddy DNS.
> **Date:** 2026-10-05

## Finalized decisions

| Item | Decision |
|---|---|
| Domain | `tithihospital.com` (registered at GoDaddy) |
| Frontend | `https://tithihospital.com` — static React build on the **Doodle** plan (shared IP `103.191.209.46`); `tithihospital.com` added there as an addon domain |
| Backend API | `https://api.tithihospital.com` — Node.js app on the **Max** plan (has Setup Node.js App) |
| Hosting | **Split across two MilesWeb cPanel accounts:** frontend on **Doodle**, backend + MySQL on **Max** |
| Node.js | Supported on **Max** (Setup Node.js App confirmed) |
| DNS | Managed at **GoDaddy** via A records: `@`/`www` -> `103.191.209.46` (Doodle), `api` -> Max server IP |

MilesWeb account has 3 plans: **Max** (`bddcrm.com`, Node.js ✓), **Doodle** (`bindassdealdigital.com`), **Swift-DA** (`bindassdeal.com`). Use **Max**.

## Current situation (context)

- `tithihospital.com` nameservers currently point to Hostinger (`ns1/ns2.dns-parking.com`) — a Hostinger account you do **not** control. You take control back from GoDaddy (registrar) by switching nameservers/records there.
- The current `*.bindassdealdigital.com` app/API live on other MilesWeb boxes (`herosite.pro`, `103.191.208/209.x`) — not the Max plan.

---

## Step 0 — Gather info from the Max cPanel

1. MilesWeb -> **Max** -> **Manage** -> open **cPanel**.
2. Note the **Shared IP Address** (cPanel right sidebar). Call it `<MAX_IP>`.
3. Note the **cPanel username** (used as the `username_` prefix for DB name/user).

## Step 1 — Create the domains in cPanel (Max)

1. **Addon domain:** cPanel -> **Domains** (or "Create Domain") -> add `tithihospital.com`.
   - Give it its **own** document root (e.g. `/home/<user>/tithihospital.com`), **not** shared with `bddcrm.com`'s `public_html`.
   - `www.tithihospital.com` is created automatically.
2. **Subdomain for the API:** create `api.tithihospital.com` (its document root will be managed by the Node app via Passenger — see Step 3).

## Step 2 — Database (MySQL)

1. cPanel -> **MySQL Databases**:
   - Create database -> `<user>_tithi`
   - Create user -> `<user>_tithi` with a strong password
   - Add user to database with **ALL PRIVILEGES**
2. Migrate data: export the current DB via phpMyAdmin on the old host, import into the new DB here.
   (Alternatively, let `sequelize.sync({ alter: true })` auto-create tables on first boot — fine for a fresh start, but prefer a real import for existing data.)
3. The Node app will connect to **`127.0.0.1:3306`** (use `127.0.0.1`, not `localhost`, so Node doesn't pick IPv6 `::1`).

## Step 3 — Deploy the backend (Node.js app)

1. Upload the backend source to a folder **outside** the web root, e.g. `/home/<user>/apps/tithi-api`
   (keeps `server.js`, `.env`, etc. unservable). **Exclude** `node_modules/` and any `.env` file.
2. cPanel -> **Setup Node.js App** -> **Create Application**:
   - Node.js version: **>= 18**
   - Application mode: **Production**
   - Application root: `apps/tithi-api`
   - Application URL: `api.tithihospital.com`
   - Application startup file: `server.js`
3. In the app's **Environment variables**, add (do NOT commit these):
   - `DB_NAME=<user>_tithi`
   - `DB_USER=<user>_tithi`
   - `DB_PASSWORD=<strong password>`
   - `DB_HOST=127.0.0.1`
   - `DB_PORT=3306`
   - `JWT_SECRET=<long random string>`  ← **fix the `your_jwt_secret` placeholder**
   - `JWT_EXPIRE=30d`
   - `RAZORPAY_KEY_ID=...`
   - `RAZORPAY_KEY_SECRET=...`
   - `RAZORPAY_CALLBACK_URL=https://tithihospital.com/`
4. Click **NPM Install**, then **Restart**.
5. Ensure the `invoices/` folder exists and is writable (PDFs are written there and served at `/invoices`).
6. Passenger injects the port, so `app.listen(process.env.PORT || 5000)` works unchanged.

## Step 4 — Deploy the frontend (static build)

1. Build **locally** with production env (Vite inlines env vars at build time):
   - `VITE_API_URL=https://api.tithihospital.com/api`
   - `VITE_CALLBACK_URL=https://tithihospital.com/book?s=3`
   - `npm run build`
2. Upload the contents of `dist/` into the `tithihospital.com` addon docroot (from Step 1).
3. Add `.htaccess` (SPA routing for React Router BrowserRouter):

   ```apache
   <IfModule mod_rewrite.c>
     RewriteEngine On
     RewriteBase /
     RewriteRule ^index\.html$ - [L]
     RewriteCond %{REQUEST_FILENAME} !-f
     RewriteCond %{REQUEST_FILENAME} !-d
     RewriteRule . /index.html [L]
   </IfModule>
   ```

## Step 5 — DNS at GoDaddy (map to Max server)

Nameservers currently point to Hostinger. Switch control back to GoDaddy, then add A records:

1. GoDaddy -> Domain `tithihospital.com` -> **Nameservers** -> set to **GoDaddy default** ("I'll use GoDaddy nameservers"). This removes the old Hostinger (`dns-parking.com`) delegation and creates a fresh zone at GoDaddy. **Note:** the old Hostinger MX (`mx*.hostinger.in`) no longer applies — recreate MX/SPF at GoDaddy if the domain needs email.
2. GoDaddy -> **DNS records**:
   - `A    @     -> 103.191.209.46`   (frontend, Doodle) (TTL 600)
   - `CNAME www  -> @`   (or `A www -> 103.191.209.46`)
   - `A    api   -> <MAX_IP>`   (backend, Max — add once the Node app is deployed)
   - Remove/replace GoDaddy's default parked `@` record.
3. Propagation: nameserver change can take up to 24-48 h; A-record edits (once GoDaddy is authoritative) resolve in minutes-to-hours.
4. Verify with: `Resolve-DnsName tithihospital.com` and `Resolve-DnsName api.tithihospital.com` -> both should return `<MAX_IP>`.

## Step 6 — SSL

Once DNS resolves to the Max server, cPanel -> **SSL/TLS Status** -> **Run AutoSSL** for `tithihospital.com`, `www.tithihospital.com`, and `api.tithihospital.com` (Let's Encrypt). Confirm HTTPS works on all three.

## Step 7 — Post-deploy config & verification

- **CORS:** lock the backend to `https://tithihospital.com` (currently `app.use(cors())` allows all).
- **Razorpay:** confirm the live keys + callback URL in the dashboard match the new domain.
- **Health check:** `GET https://api.tithihospital.com/` -> `{ "message": "API is running" }`.
- **Smoke test:** load the site, create an appointment, run a test payment, generate an invoice PDF.
- **Before going live,** address the security items in `project-analysis.md` (apply `protect`/`admin` middleware to appointment/transaction/payment routes; set a strong `JWT_SECRET`; stop using `sync({ alter: true })` in production).

## Quick checklist

- [ ] Get `<MAX_IP>` + cPanel username
- [ ] Add addon domain `tithihospital.com` (own docroot) + subdomain `api.tithihospital.com`
- [ ] Create MySQL DB/user, import data
- [ ] Upload backend outside web root; create Node.js app; set env vars; NPM install; restart
- [ ] Build frontend with prod env; upload `dist/`; add `.htaccess`
- [ ] GoDaddy: switch NS to GoDaddy, add A records `@` + `api` -> `<MAX_IP>`
- [ ] Run AutoSSL for all three hostnames
- [ ] Fix CORS / JWT secret / route auth; smoke-test end to end
