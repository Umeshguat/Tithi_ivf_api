const express = require("express");
const router = express.Router();
const { register, login, getProfile, getDashboard, logout } = require("../controllers/authController");
const { protect, admin } = require("../middleware/auth");
const { authLimiter } = require("../middleware/rateLimiter");


router.post("/register", authLimiter, register);
router.post("/login", authLimiter, login);
router.post("/logout", protect, logout);
router.get("/profile", protect, getProfile);
router.get("/dashboard", protect, admin, getDashboard);

module.exports = router;
