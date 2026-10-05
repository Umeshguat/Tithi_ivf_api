# Tithi IVF — Project Analysis

> Snapshot analysis of the Tithi IVF appointment-booking + payment system.
> **Date:** 2026-10-05 · Read-only review, no code changed.

## 1. Overview

A fertility-clinic **appointment booking + online payment** system for "Tithi IVF / Tithi Hospital". The repository holds three independent codebases:

| Directory | Stack | Status |
|---|---|---|
| `frontend/` | React 18 + TypeScript + Vite + shadcn/ui + Tailwind + Zustand + React Query + axios | **Active** — deployed to `tithi.bindassdealdigital.com` |
| `backend/` | Node.js + Express 5 + Sequelize + MySQL + Razorpay + JWT + PDFKit | **Active** — deployed to `apitithi.bindassdealdigital.com` |
| `backend_old/` | Laravel 12 / PHP 8.2 + Sanctum | **Legacy** — superseded by the Node backend |

Frontend and backend are separate git repositories (`irudhirn/tithi_frontend`, `Umeshguat/Tithi_ivf_api`). `backend_old` is the original PHP implementation kept for reference.

## 2. What it does

- **Public visitors** book appointments: pick a date → see generated time slots (morning/evening) → pay via Razorpay → receive a booking ID.
- **Patients** have a dashboard/profile (login intended via mobile + OTP).
- **Admins** manage weekday availability, services & pricing, holidays, blocked slots, view all appointments/patients, and update appointment status.

## 3. Backend architecture

- `server.js` wires 7 route groups under `/api/*`, serves invoice PDFs statically, and runs `sequelize.sync({ alter: true })` on every boot.
- **Models** (`backend/models/`): `User` (user/admin role, bcrypt-hashed password, mobile/email), `Appointment`, `Transaction` (Razorpay fields), `Availability`, `BlockedSlot`, `Holiday`, `Service`.
- Slot logic (`controllers/appointmentController.js`) generates slots from availability windows and auto-creates a full-day `BlockedSlot` once everything is booked.
- Razorpay order creation, HMAC signature verification, and payment-link flows live in `controllers/paymentController.js`.

### API route protection summary

| Route group | Public | Requires login (`protect`) | Requires admin |
|---|---|---|---|
| `authRoutes` | `register`, `login` | `profile`, `dashboard` | — |
| `appointmentRoutes` | **ALL** (middleware imported but not applied) | — | — |
| `availabilityRoutes` | — | — | all |
| `paymentRoutes` | `create-order`, `create-payment-link`, `verify` | `my-payments`, `:id` | — |
| `serviceRoutes` | `GET` | `POST/PUT/DELETE` | — |
| `holidayRoutes` | `GET` | `POST/PUT/DELETE` | — |
| `transactionRoutes` | **ALL** | — | — |

## 4. Issues found

### 4.1 Security — high priority

1. **Placeholder JWT secret in production.** `backend/.env.production` sets `JWT_SECRET=your_jwt_secret`. Anyone who knows this default string can forge valid admin tokens. Most urgent item. → Replace with a long random secret and rotate.
2. **Auth middleware imported but not applied.** `routes/appointmentRoutes.js` imports `protect` but attaches it to none of the routes — so `GET /api/appointments` (lists every appointment with patient name/mobile), `PUT /api/appointments/status`, create, reschedule, and detail-lookup are all publicly accessible.
3. **Transactions fully open.** `routes/transactionRoutes.js` has no auth at all — list, read, update, and `GET /:id/invoice` are public.
4. **Payment endpoints public.** `create-order`, `create-payment-link`, and `verify` in `routes/paymentRoutes.js` have no `protect`.
5. **Admin role barely enforced.** Only `availabilityRoutes` uses the `admin` check. `getDashboard`, services, and holidays mutations require only *any* logged-in user. The frontend `ProtectedRoute.tsx` also only checks that a user exists, not their role.
6. **CORS wide open** (`app.use(cors())`); no helmet, no rate limiting.
7. ✅ `.env*` is gitignored and not tracked, so the live Razorpay secret and DB password are not in GitHub history (verified with `git ls-files`).

### 4.2 Correctness / likely bugs

8. **Patient auth & booking-lookup flows are not wired up.** The frontend calls endpoints the backend does not implement:
   - `apis/authApis.ts` posts to `/register` and `/verifyOtp`; backend only has `/auth/register`, `/auth/login`, and no OTP endpoint.
   - `apis/bookingApis.ts` calls `/booking/lookup`, `/booking/verify`, `/payment` — none exist. Only `adminLogin` → `/auth/login` matches.
9. **Main booking flow never persists a transaction.** In `appointmentController.js` (`createAppointment`), `transactionData` is built and returned but `Transaction.create` is only called in the `payment_link_id` branch — so normal bookings return a transaction object that was never saved.
10. **Inconsistent appointment-status sets** cause a double-booking gap: `getAvailableSlots` excludes `["pending","rescheduled"]`, but booking checks `["pending","confirmed"]` and auto-block counts `["pending","confirmed"]`. A `confirmed` appointment's slot still shows as available.
11. **`sequelize.sync({ alter: true })`** runs against production on every restart — risky for schema drift / data loss. Prefer migrations.
12. **Dual/confusing auth state:** `contexts/AuthContext.tsx` carries hardcoded mock data ("Sarah Johnson", sample appointments) and a mock `login()` alongside the real Zustand `useUserStore` / `useAuthStore`.

### 4.3 Housekeeping

- `mongoose` is a dependency in `backend/package.json` but unused (the app is MySQL/Sequelize).
- Stray `nul` (repo root) and `backend_old/nul_` files — artifacts of Windows `> nul` redirection.
- `backend/Tithi_ivf_api.zip` sits in the source tree (gitignored).

## 5. Deployment notes

- **Frontend:** `https://tithi.bindassdealdigital.com`
- **API:** `https://apitithi.bindassdealdigital.com/api`
- **Database:** MySQL on `localhost:3306`, db `opglffxw_tithi` (shared-hosting style naming — likely Hostinger/cPanel).
- **Payments:** Razorpay **live** keys; `RAZORPAY_CALLBACK_URL=https://tithihospital.com/`.

## 6. Suggested next steps (priority order)

1. Replace the production `JWT_SECRET` with a strong random value and rotate.
2. Apply `protect` / `admin` middleware to appointment, transaction, and payment routes.
3. Enforce role (`admin`) on admin routes and in the frontend `ProtectedRoute`.
4. Reconcile the frontend ↔ backend API contract (OTP login, booking lookup, payment recording).
5. Fix transaction persistence in the main booking flow and unify appointment-status sets.
6. Move off `sync({ alter: true })` to managed migrations for production.
