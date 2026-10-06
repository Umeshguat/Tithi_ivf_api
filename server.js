const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const dotenv = require("dotenv");

// Load env vars (must be before any module that uses process.env)
dotenv.config();

const { connectDB, sequelize } = require("./config/db");
const errorHandler = require("./middleware/errorHandler");

// Fail fast on a missing/weak JWT secret
if (
  !process.env.JWT_SECRET ||
  (process.env.NODE_ENV === "production" &&
    (process.env.JWT_SECRET.length < 32 || process.env.JWT_SECRET === "your_jwt_secret"))
) {
  console.error("FATAL: JWT_SECRET is missing or too weak (use 32+ random characters in production)");
  process.exit(1);
}

const app = express();

// Needed so rate limiting sees the real client IP behind a reverse proxy
// TRUST_PROXY = number of proxy hops in front of the app (default 1). Set to 0
// if the app is exposed directly, otherwise X-Forwarded-For can be spoofed to
// bypass rate limits.
const trustProxy = parseInt(process.env.TRUST_PROXY ?? "1", 10);
app.set("trust proxy", Number.isNaN(trustProxy) ? 1 : trustProxy);

// Middleware
app.use(helmet());

// CORS allowlist: comma-separated origins in CORS_ORIGINS
const allowedOrigins = (process.env.CORS_ORIGINS || "")
  .split(",")
  .map((o) => o.trim())
  .filter(Boolean);
app.use(
  cors({
    origin: (origin, cb) => {
      // Allow non-browser clients (no Origin header) and allowlisted origins
      if (!origin || allowedOrigins.includes(origin)) return cb(null, true);
      return cb(null, false);
    },
  })
);
app.use(express.json({ limit: "100kb" }));

// Invoices are no longer served statically; they are streamed by an
// authorized controller (GET /api/transactions/:id/invoice).

// Routes
app.use("/api/auth", require("./routes/authRoutes"));
app.use("/api/appointments", require("./routes/appointmentRoutes"));
app.use("/api/admin/availability", require("./routes/availabilityRoutes"));
app.use("/api/transactions", require("./routes/transactionRoutes"));
app.use("/api/payments", require("./routes/paymentRoutes"));
app.use("/api/services", require("./routes/serviceRoutes"));
app.use("/api/holidays", require("./routes/holidayRoutes"));

// Health check
app.get("/", (req, res) => {
  res.json({ message: "API is running" });
});

// Error handler (must be after routes)
app.use(errorHandler);

const PORT = process.env.PORT || 5000;

const startServer = async () => {
  await connectDB();
  // Load all models so associations are registered before sync
  require("./models/User");
  require("./models/Appointment"); // This also loads Transaction & sets up associations
  require("./models/Service");
  require("./models/Availability");
  require("./models/BlockedSlot");
  require("./models/Holiday");
  // sync() only creates missing tables (never alters). Set DB_SYNC=false once the
  // schema exists to stop the app touching the schema at runtime.
  if (process.env.DB_SYNC !== "false") {
    await sequelize.sync();
    console.log("✅ Database tables synced");
  }
  app.listen(PORT, () => {
    console.log(`🟢 Server running on port ${PORT}`);
  });
};

startServer();
