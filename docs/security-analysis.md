# Tithi IVF — Security Analysis

> Security review of the Tithi IVF appointment-booking + payment system (frontend + backend).
> **Date:** 2026-10-06 · Read-only review, no code changed.

## Scope

| Codebase | Stack |
|---|---|
| `backend/` | Node.js + Express 5 + Sequelize/MySQL + Razorpay + JWT + PDFKit |
| `frontend/` | React 18 + TypeScript + Vite + Zustand + React Query + axios |

This is a fertility-clinic booking + online payment system, so the data in play is **medical PII (PHI) + payment data** — which raises the impact of every finding below.

## Executive summary

The headline: **authentication/authorization is effectively missing on the backend, and payment confirmation is forgeable.** Together these let an anonymous attacker read all patient data and book paid appointments for free.

| # | Severity | Finding |
|---|---|---|
| 1 | 🔴 Critical | Almost no backend endpoint enforces authentication (Broken Access Control) |
| 2 | 🔴 Critical | Payment confirmation is forgeable (Broken payment logic) |
| 3 | 🔴 Critical | Live production secrets stored in plaintext |
| 4 | 🟠 High | Patient PII / PHI exposure (no auth required) |
| 5 | 🟠 High | Frontend admin area has no role check |
| 6 | 🟠 High | No rate limiting / brute-force protection |
| 7 | 🟠 High | CORS fully open |
| 8 | 🟡 Medium | Long-lived JWT in localStorage |
| 9 | 🟡 Medium | Verbose error messages leak internals |
| 10 | 🟡 Medium | Missing security headers (no helmet/CSP) |
| 11 | 🟡 Medium | Client-trusted financial fields |
| 12 | 🟢 Low | Hygiene issues (see section) |

---

## 🔴 CRITICAL

### 1. Almost no backend endpoint enforces authentication (Broken Access Control)

The `protect`/`admin` middleware exists (`backend/middleware/auth.js`) but is **not applied** to most routes.

- **`backend/routes/appointmentRoutes.js:14-21`** — all 6 routes are public. `protect` is imported and never used:
  - `GET /api/appointments` returns **every appointment with full user PII** (name, mobile, email) — intended as an admin screen (`appointmentController.js:378`).
  - `PUT /api/appointments/status` — anyone can change any appointment's status.
  - `POST /api/appointments/get-appointment-detail` — PII lookup (see #4).
- **`backend/routes/transactionRoutes.js:11-15`** — all 5 routes public:
  - `GET /api/transactions` — lists **all transactions + patient PII**.
  - `GET /api/transactions/:id` — IDOR, read any transaction by sequential ID.
  - **`PUT /api/transactions/:id` — anyone can mark any transaction `completed`** (`transactionController.js:139`).
  - `GET /api/transactions/:id/invoice` — generate invoice PDF for any transaction (see #4).
- **`backend/routes/serviceRoutes.js:12-16`** & **`backend/routes/holidayRoutes.js:12-16`** — write operations use `protect` but **not `admin`**. Since registration is open, *any* self-registered user can create/update/delete services (and thus prices) and holidays.
- Only **`backend/routes/availabilityRoutes.js`** correctly uses `protect, admin`.

**Fix:** apply `protect` to all authenticated routes and `protect, admin` to all admin routes. Audit every route file against its intended access level.

### 2. Payment confirmation is forgeable (Broken payment logic)

The Razorpay **payment-link** return flow is never verified server-side.

- After payment, the frontend reads `razorpay_payment_link_status` **from the URL** and passes it as `status` to `POST /api/appointments` (`frontend/src/pages/public/PublicBooking.tsx:159-189`).
- The backend trusts it and writes it straight onto the Transaction (`appointmentController.js:190-216`). There is **no HMAC signature check** on the payment-link callback.
- Because `createAppointment` is also unauthenticated and accepts `amount`, `status`, and `transaction_id` from the body, an attacker can `POST /api/appointments` with `status: "completed"` and book a **paid appointment for ₹0**.
- `createOrder` accepts an **arbitrary `amount`** from the client with no validation against a service price (`paymentController.js:16-52`) → price manipulation.
- The one endpoint that *does* verify the signature correctly, `verifyPayment` (`paymentController.js:93`), is **not used anywhere in the booking flow**.

**Fix:** verify the Razorpay signature server-side (payment links return `razorpay_signature`; HMAC-SHA256 it) before marking anything paid. Derive `amount` and `status` on the server from the Razorpay order/payment, never from the client.

### 3. Live production secrets stored in plaintext

`backend/.env.production` contains:
- **Live Razorpay secret** (`RAZORPAY_KEY_SECRET`, with a `rzp_live_` key id) — full access to charge/refund.
- **DB password.**
- JWT signing secret.

`.env*` is git-ignored and none of these were ever committed to the backend git repo. **However**, `backend.zip` and `Tithi_ivf_api.zip` sit in the repo folder and the backend has a public GitHub remote (`github.com/Umeshguat/Tithi_ivf_api`). `backend/.env` / `.env.local` also ship a weak dev JWT secret (`your_jwt_secret`).

**Fix:** if the live secret has ever been zipped, shared, or pasted, **rotate it** (Razorpay key secret + DB password). Store production secrets in the host's environment-variable store, not a file on disk. Generate a strong, unique `JWT_SECRET`.

---

## 🟠 HIGH

### 4. Patient PII / PHI exposure (no auth required)

- `GET /api/transactions/:id/invoice` generates a PDF containing patient **name, email, mobile** for any sequential transaction id, with no auth, and serves it as a **static file** from `/invoices` (`server.js:19`, `transactionController.js:172`) with no access control.
- `get-appointment-detail` returns the full appointment + user record from just a `booking_id`; the mobile check is **bypassed by omitting `mobile`** (`appointmentController.js:465-497`).

**Fix:** require auth + ownership checks on invoice/detail endpoints; do not serve invoice PDFs from a world-readable static path — stream them through an authorized controller.

### 5. Frontend admin area has no role check

`frontend/src/components/ProtectedRoute.tsx` only checks `if (!user)` — not role. Any logged-in patient can open `/admin/*` (`frontend/src/App.tsx:68-87`). Combined with #1, the admin functions are fully reachable.

**Fix:** add a role-aware guard (e.g. `requireRole="admin"`) for the admin route group. Note this is defense-in-depth only — the real control must be on the backend (#1).

### 6. No rate limiting / brute-force protection

`/api/auth/login` and `/register` (`backend/routes/authRoutes.js`) have no throttling or lockout → credential brute force, booking/transaction enumeration, and payment-link spam (each link triggers billable SMS/email via Razorpay `notify`).

**Fix:** add `express-rate-limit` (stricter on auth + payment endpoints) and consider lockout/backoff on repeated login failures.

### 7. CORS fully open

`app.use(cors())` (`server.js:15`) allows any origin.

**Fix:** restrict to the known frontend origin(s) via an allowlist.

---

## 🟡 MEDIUM

### 8. Long-lived JWT in localStorage
`JWT_EXPIRE=30d`, token stored in `localStorage` (`frontend/src/store/useAuthStore.ts`, `frontend/src/lib/axiosInstance.ts:10`) → XSS-exfiltratable, no server-side revocation/logout. **Fix:** shorten expiry, consider httpOnly cookies + refresh tokens, add server-side invalidation.

### 9. Verbose error messages leak internals
Global handler and controllers return raw `error.message` (and validation `details`) to clients (`backend/middleware/errorHandler.js`, `appointmentController.js:236`). **Fix:** log full errors server-side; return generic messages to clients.

### 10. Missing security headers (no helmet/CSP)
`helmet` is not installed; no CSP (none in `frontend/index.html`), HSTS, X-Frame-Options, or X-Content-Type-Options. **Fix:** add `helmet` to the backend and a CSP for the frontend.

### 11. Client-trusted financial fields
`status` / `amount` / `transaction_reference` are accepted from the request body in appointment & transaction creation. **Fix:** derive these server-side from the verified payment.

---

## 🟢 LOW / Hygiene

- Frontend `.env` is git-tracked (only public API URLs today — low risk, but tracking the file means a future secret added there would leak).
- `handleDownloadInvoice` builds HTML via `document.write` with interpolated booking fields (`frontend/src/pages/public/PublicBooking.tsx:296`) — low-risk reflected XSS; worth escaping.
- Unused `mongoose` dependency; `express.json()` has no explicit body-size limit; password policy is just min-length 6; stray `nul` file at repo root.

### Things that are already good
- **No SQL injection** — Sequelize queries are parameterized throughout; no raw queries.
- Passwords are **bcrypt-hashed** (cost 10) with a `defaultScope` that excludes the hash from reads.
- Registration correctly defaults `role` to `user` — no privilege escalation via signup.

---

## Suggested remediation order

1. **Rotate** the live Razorpay secret + DB password if there's any chance they leaked; move all prod secrets into the host's env-var store (not a file).
2. Apply `protect`/`admin` to every non-public route (#1); **verify Razorpay payment server-side** (HMAC) before trusting any paid status, and stop accepting `status`/`amount` from the client (#2, #11).
3. Add a role check to `ProtectedRoute` and lock `/invoices` + detail endpoints behind ownership checks (#4, #5).
4. Add `helmet`, an explicit CORS allowlist, and rate limiting on auth + payment endpoints (#6, #7, #10).
5. Clean up the remainder (JWT lifetime, error verbosity, body limits) (#8, #9).

---

## Remediation status (backend, 2026-10-06)

| # | Status | What changed |
|---|---|---|
| 1 | ✅ Fixed | `protect`/`admin` applied: appointments list/status, transactions (all), services/holidays writes, dashboard are admin-only; reschedule needs login (own appointment only). Public by design: create appointment, available-slots, appointment-detail (now needs `booking_id` **and** `mobile`), service/holiday reads, create-payment-link. `protect` now 401s for deleted users. |
| 2, 11 | ✅ Fixed | `createAppointment` no longer reads `status`/`amount` from the body. It fetches the payment link from Razorpay's API, requires `status === "paid"`, takes the amount/payment id from Razorpay, and rejects reused/unknown links. `createOrder` validates the amount against `Service` prices and appointment ownership. `verifyPayment` uses a timing-safe compare and ownership check, and no longer lets anyone flip transactions to `failed`. |
| 3 | ⚠️ Manual | Rotate the Razorpay secret + DB password and generate a strong `JWT_SECRET`. Server now refuses to start in production with a missing/weak JWT secret. `.env.example` added. |
| 4 | ✅ Fixed | `/invoices` static route removed; invoice PDF is streamed (no disk file) to admin/owner only. **API contract change:** `GET /api/transactions/:id/invoice` now returns the PDF itself, not JSON with `invoice_url`. |
| 5 | ⏳ Frontend | Not in this repo — add a role guard to `ProtectedRoute` in the frontend. |
| 6 | ✅ Fixed | `express-rate-limit` on login/register, payment endpoints, public booking endpoints. |
| 7 | ✅ Fixed | CORS allowlist via `CORS_ORIGINS` env (comma-separated). Payment `callback_url` must be on an allowlisted origin. **Set `CORS_ORIGINS` or browsers will be blocked.** |
| 8 | 🟡 Partial | JWT default expiry 1d (was 30d via env). httpOnly cookies / revocation need frontend work. |
| 9 | ✅ Fixed | Generic 500 messages; details only in server logs. |
| 10 | ✅ Fixed | `helmet` added (frontend CSP still to do). |
| 12 | 🟡 Partial | `mongoose` removed, body limit 100kb, password min 8, pagination caps, status whitelists. Frontend items (`.env` tracking, `document.write` escaping) remain. |

## Round 2 remediation (re-analysis findings)

| Finding | Status | What changed |
|---|---|---|
| Payment link double-claim (race) | ✅ Fixed | Booking runs in a DB transaction; the payment-link row is locked (`FOR UPDATE`) and re-checked before it is claimed. |
| Slot double-booking / arbitrary time | ✅ Fixed | Day's `Availability` row is locked per booking; time must be one of the generated slots; past dates rejected; same check on reschedule (excluding itself). No DB migration needed. |
| Payment-link SMS/email spam | ✅ Fixed | `notify` and reminders off; contact/email/name/notes validated; link expires in 24h. |
| Vulnerable dependencies | ✅ Mostly | `npm audit fix` applied: critical/high cleared. Remaining: `sequelize` JSON-cast moderate advisory (only fix is a breaking v7 alpha; the app uses no JSON columns). |
| `trust proxy` / rate-limit bypass | ✅ Configurable | `TRUST_PROXY` env (default 1). Set to the real proxy hop count, `0` if exposed directly. |
| Account enumeration | ✅ Fixed | Generic register failure message; login does a dummy bcrypt compare for unknown users. |
| Guest/account collisions | ✅ Fixed | Guest bookings can't attach to admin accounts; response echoes submitted name, never stored user data. |
| Orphan payment-link transactions | ✅ Fixed | Unclaimed pending link transactions older than 48h are purged on new link creation. |
| Input validation | ✅ Fixed | Types/lengths for name, description, duration, date, time, email, notes. |
| PII in logs | ✅ Fixed | `utils/logger.js` logs name/message only (no SQL/params); stack outside production. |
| JWT revocation / alg pinning | ✅ Fixed | HS256 pinned on sign+verify; tokens issued before the user's last update are rejected; new `POST /api/auth/logout` revokes tokens. |
| `sequelize.sync()` in prod | ✅ Optional | `DB_SYNC=false` disables it. |
| Secret rotation (#3) | ⚠️ Manual | Still requires rotating Razorpay/DB/JWT secrets. |
| Frontend items | ⏳ Not in repo | Role guard, CSP, token storage, `document.write` escaping. |

## Architecture clarification & follow-up (2026-10-06)

**Clarified design:** patients **never authenticate**. They book as guests via `/book`
and view bookings via `/view-booking`, which is gated by **booking_id + mobile**
(both required, mobile must match — enforced server-side in `getAppointmentDetails`).
`PatientLayout` and the `/patient/*` routes are unused. **Only admins log in.**

### Impact on earlier findings

- **#5 (frontend admin role guard) — downgraded 🟠 High → 🟢 Low.** With no patient
  login there is no logged-in patient to pivot into `/admin`, and the backend already
  enforces `admin` on every sensitive endpoint (verified). A non-admin token (e.g. a
  leftover `user`) could at most *render* the admin shell while every API call 403s.
  A role guard was still added as UI defense-in-depth.
- **New finding — public self-registration is unnecessary attack surface.**
  `POST /api/auth/register` let anyone mint `user` accounts (DB growth, token issuance,
  bcrypt CPU, enumeration target) for a product that has no patient accounts. **Disabled.**

### Changes applied (reversible / commented-out)

| Area | Change |
|---|---|
| `routes/authRoutes.js` | `POST /register` route commented out (self-registration disabled). |
| `controllers/authController.js` | Login response now includes `role` so the UI can verify admin. |
| `frontend ProtectedRoute.tsx` | Requires `user.role === "admin"`; redirects to `/admin-login` (was `/login`). |
| `frontend useUserStore.ts` | `User` type gains optional `role`. |
| `frontend AdminLogin.tsx` | Stores `role` from the login response. |
| `frontend App.tsx` | Patient imports + `/patient/*`, `/login`, `/signup` routes commented out. |
| `frontend PublicLayout.tsx` | Mobile nav: removed `/patient/profile` link; fixed dead `/login` link → `/view-booking`. |

> Note: existing admin sessions in `localStorage` predate the `role` field, so admins
> must log in once after this change for the guard to pass.

### Still pending / manual

- **#3 secrets NOT rotated** — `backend/.env.production` still holds the original live
  Razorpay secret + DB password. Rotate them.
- **Production `.env` gaps** — set `CORS_ORIGINS` (empty allowlist blocks all browsers),
  `NODE_ENV=production` (enables the weak-JWT fail-fast), `DB_SYNC=false`, and lower
  `JWT_EXPIRE` from `30d` (it overrides the new 1d default).
- **Other frontend hardening** — CSP, token storage, `document.write` escaping, `.env`
  git-tracking.
- **Dead client methods** — `bookingApis.lookupBooking/verifyAndGetBooking` call
  `/booking/lookup` and `/booking/verify`, which don't exist on the backend; remove or implement.
