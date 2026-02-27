const express = require("express");
const router = express.Router();
const { register, login, getProfile, getDashboard } = require("../controllers/authController");
const { protect } = require("../middleware/auth");


router.post("/register", register);
router.post("/login", login);
router.get("/profile", protect, getProfile);
router.get("/dashboard", protect,  getDashboard);

module.exports = router;
