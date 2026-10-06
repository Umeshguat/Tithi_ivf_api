const rateLimit = require("express-rate-limit");

const make = (windowMs, limit, message) =>
  rateLimit({
    windowMs,
    limit,
    standardHeaders: true,
    legacyHeaders: false,
    message: { success: false, message },
  });

// Login / register brute-force protection
const authLimiter = make(15 * 60 * 1000, 20, "Too many attempts, please try again later");

// Payment link creation triggers billable SMS/email via Razorpay
const paymentLimiter = make(60 * 60 * 1000, 20, "Too many payment requests, please try again later");

// Public booking / lookup endpoints
const publicLimiter = make(15 * 60 * 1000, 60, "Too many requests, please try again later");

module.exports = { authLimiter, paymentLimiter, publicLimiter };
