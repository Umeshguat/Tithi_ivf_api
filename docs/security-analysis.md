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
