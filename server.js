const express = require("express");
const cors = require("cors");
const dotenv = require("dotenv");

// Load env vars (must be before any module that uses process.env)
dotenv.config();

const { connectDB, sequelize } = require("./config/db");
const errorHandler = require("./middleware/errorHandler");

const app = express();

// Middleware
app.use(cors());
app.use(express.json());

// Routes
app.use("/api/auth", require("./routes/authRoutes"));
app.use("/api/appointments", require("./routes/appointmentRoutes"));
app.use("/api/availability", require("./routes/availabilityRoutes"));

// Health check
app.get("/", (req, res) => {
  res.json({ message: "API is running" });
});

// Error handler (must be after routes)
app.use(errorHandler);

const PORT = process.env.PORT || 5000;

const startServer = async () => {
  await connectDB();
  await sequelize.sync();
  console.log("✅ Database tables synced");
  app.listen(PORT, () => {
    console.log(`🟢 Server running on port ${PORT}`);
  });
};

startServer();
