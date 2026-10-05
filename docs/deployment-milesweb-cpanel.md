# Deployment Plan — MilesWeb cPanel + GoDaddy DNS

> How to deploy the Tithi IVF stack (React frontend + Express backend + MySQL) on MilesWeb's cPanel and map the GoDaddy domain to it.
> **Date:** 2026-10-05

## 0. Current hosting situation (for context)

Reverse-DNS / DNS lookups done during analysis:

| Host | IP | Reverse DNS | What it is |
|---|---|---|---|
| `tithi.bindassdealdigital.com` (frontend) | `103.191.209.46` | `kindle.herosite.pro` | cPanel-style shared server |
| `apitithi.bindassdealdigital.com` (API + MySQL) | `103.191.208.227` | `emphasis.herosite.pro` | cPanel-style shared server |
| `tithihospital.com` | `91.108.106.104`, `88.222.243.112` | Hostinger (`init.lt`) | Hostinger — **a different account you don't control** |

Notes:
- The connected Hostinger account is **empty** (0 websites, 0 domains), confirming `tithihospital.com` lives on someone else's Hostinger account.
- `tithihospital.com` nameservers point to Hostinger (`ns1/ns2.dns-parking.com`), so DNS is currently controlled by that other account — not GoDaddy. You regain control by changing nameservers at GoDaddy (where you have access).
- The current app/API/DB are already on a **cPanel host** (`herosite.pro`); the DB name `opglffxw_tithi` is a classic cPanel `username_db` prefix. The stack is already cPanel-shaped, so moving to MilesWeb cPanel is straightforward.

## 1. Target architecture on one cPanel account

```
tithihospital.com        -> public_html/      -> React build (static SPA)
api.tithihospital.com    -> Node.js app       -> Express backend (subdomain)
MySQL (127.0.0.1:3306)   -> cPanel MySQL DB   -> same account
```

## ⚠️ Prerequisite to verify FIRST

Confirm the MilesWeb plan has **"Setup Node.js App"** (Application Manager / Phusion Passenger) and a **Node >= 18** option. Express 5 and the current dependencies require it. If the shared plan lacks Node.js support, the backend cannot run there — you would need MilesWeb's Cloud/VPS tier (or host the API elsewhere).

## 2. Frontend (Vite / React — static)

1. Set build-time env vars **before** building (Vite inlines them at build time):
   - `VITE_API_URL=https://api.tithihospital.com/api`
   - `VITE_CALLBACK_URL=https://tithihospital.com/...`
2. `npm run build` -> upload the contents of `dist/` to `public_html` (main domain) or a subdomain docroot.
3. Add an `.htaccess` SPA rewrite so React Router (BrowserRouter) deep links work:

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

   (The frontend repo already has an `.htaccess` per its git history — reuse it.)

## 3. Backend (Express)

1. cPanel -> **Setup Node.js App**:
   - Application root = uploaded backend folder
   - Startup file = `server.js`
   - Application URL = `api.tithihospital.com`
   - Node version >= 18
2. Click **NPM Install** in that UI (do **not** upload `node_modules`).
3. Set environment variables in the Node app UI (not a committed `.env`):
   - `DB_NAME`, `DB_USER`, `DB_PASSWORD`, `DB_HOST=127.0.0.1`, `DB_PORT=3306`
   - `JWT_SECRET` = a long random string (**fix the `your_jwt_secret` placeholder**)
   - `JWT_EXPIRE=30d`
   - `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`, `RAZORPAY_CALLBACK_URL`
4. Passenger injects the port, so `app.listen(process.env.PORT || 5000)` works as-is.
5. Lock down **CORS** to `https://tithihospital.com` only (currently wide open with `app.use(cors())`).

## 4. Database (MySQL)

1. cPanel -> **MySQL Databases**: create DB + user, grant all privileges (names get a `youracct_` prefix).
2. The Node app connects to `127.0.0.1:3306` (use `127.0.0.1`, not `localhost`, so Node doesn't resolve to IPv6 `::1`).
3. Migrate data: export/import the existing schema + data via phpMyAdmin.
4. The app runs `sequelize.sync({ alter: true })`, which auto-creates tables on first boot — acceptable for first deploy, but disable `alter` in production and use managed migrations (see analysis doc).

## 5. DNS at GoDaddy

`tithihospital.com` nameservers currently point to Hostinger (`dns-parking.com`). Regain control at GoDaddy, then choose one:

- **Option A (recommended): point nameservers to MilesWeb.**
  GoDaddy -> Domain -> Nameservers -> enter MilesWeb's NS (e.g. `ns1.milesweb.com` / `ns2...` from the welcome email). Manage all records in cPanel's Zone Editor. Propagation up to 24-48 h.
- **Option B: keep GoDaddy DNS, set A records to MilesWeb IP.**
  Set NS back to GoDaddy default, then add:
  - `A  @   -> <MilesWeb IP>`
  - `CNAME www -> @` (or an A record)
  - `A  api -> <MilesWeb IP>`

After DNS resolves to MilesWeb, run **AutoSSL / Let's Encrypt** in cPanel for `tithihospital.com` and `api.tithihospital.com`.

## 6. Config changes that must follow the domain move

- `VITE_API_URL` -> `https://api.tithihospital.com/api` (then rebuild the frontend)
- `RAZORPAY_CALLBACK_URL` -> new domain
- CORS origin -> new domain
- Strong random `JWT_SECRET`

## 7. Open decisions (confirm before the step-by-step runbook)

1. Which domain for the new project — `tithihospital.com` itself, or keep the `bindassdealdigital.com` subdomains?
2. Frontend + API on the same domain (API on an `api.` subdomain), or separate domains?
3. Does the MilesWeb plan show **"Setup Node.js App"** in cPanel? (If unsure, check the plan name.)
