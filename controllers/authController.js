const { logError } = require("../utils/logger");
const jwt = require("jsonwebtoken");
const bcrypt = require("bcryptjs");
const User = require("../models/User");

// Valid bcrypt hash (cost 10) of a random value, used for constant-time login misses
const DUMMY_HASH = bcrypt.hashSync(require("crypto").randomBytes(16).toString("hex"), 10);
const Apointment = require("../models/Appointment");

// Generate JWT token
const generateToken = (id) => {
  return jwt.sign({ id }, process.env.JWT_SECRET, {
    algorithm: "HS256",
    expiresIn: process.env.JWT_EXPIRE || "1d",
  });
};

// @desc    Register a new user
// @route   POST /api/auth/register
const register = async (req, res) => {
  try {
    const { name, mobile, email, password } = req.body;

    if (!password || String(password).length < 8) {
      return res.status(400).json({ success: false, message: "Password must be at least 8 characters" });
    }

    const GENERIC_FAIL = "Unable to register with the provided details";
    if (!name || !email || typeof email !== "string" || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return res.status(400).json({ success: false, message: "Valid name and email are required" });
    }

    // Same response for every duplicate (email OR mobile) to avoid account enumeration
    const userExists = await User.findOne({ where: { email } });
    if (userExists) {
      return res.status(400).json({ success: false, message: GENERIC_FAIL });
    }

    const user = await User.create({ name, mobile, email, password });

    res.status(201).json({
      success: true,
      data: {
        id: user.id,
        name: user.name,
        email: user.email,
        token: generateToken(user.id),
      },
    });
  } catch (error) {
    logError("auth", error);
    if (error.name === "SequelizeUniqueConstraintError") {
      return res.status(400).json({ success: false, message: "Unable to register with the provided details" });
    }
    if (error.name === "SequelizeValidationError") {
      return res.status(400).json({
        success: false,
        message: error.errors.map((e) => e.message).join(", "),
      });
    }
    res.status(500).json({ success: false, message: "Internal server error" });
  }
};

// @desc    Login user
// @route   POST /api/auth/login
const login = async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password || typeof email !== "string" || typeof password !== "string") {
      return res.status(400).json({ success: false, message: "Please provide email and password" });
    }

    const user = await User.scope("withPassword").findOne({ where: { email } });
    if (!user || !user.password) {
      // Burn the same bcrypt time as a real check so response timing
      // doesn't reveal whether the account exists
      await bcrypt.compare(password, DUMMY_HASH);
      return res.status(401).json({ success: false, message: "Invalid credentials" });
    }

    const isMatch = await user.matchPassword(password);
    if (!isMatch) {
      return res.status(401).json({ success: false, message: "Invalid credentials" });
    }

    res.json({
      success: true,
      data: {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
        token: generateToken(user.id),
      },
    });
  } catch (error) {
    logError("auth", error);
    res.status(500).json({ success: false, message: "Internal server error" });
  }
};

// @desc    Get logged-in user profile
// @route   GET /api/auth/profile
const getProfile = async (req, res) => {
  try {
    const user = await User.findByPk(req.user.id);
    res.json({
      success: true,
      data: user,
    });
  } catch (error) {
    logError("auth", error);
    res.status(500).json({ success: false, message: "Internal server error" });
  }
};

const getDashboard = async (req, res) => {
  try {

    const appointments = await Apointment.findAll();
    const totalUsers = await User.findAll({ where: { role: "user" } });

    res.json({
      success: 200,
      message: "Welcome to the dashboard!",
      totalusers: totalUsers.length,
      appointments: appointments.length,
      pendingAppointments: appointments.filter(app => app.status === "pending").length,
      completedAppointments: appointments.filter(app => app.status === "completed").length,
      
    });
  } catch (error) {
    logError("auth", error);
    res.status(500).json({ success: 500, message: "Internal server error" });
  }
}

// @desc    Revoke all tokens issued so far for this user
// @route   POST /api/auth/logout
const logout = async (req, res) => {
  try {
    // Bulk update always bumps updatedAt, which invalidates earlier tokens
    await User.update({ name: req.user.name }, { where: { id: req.user.id } });
    res.json({ success: true, message: "Logged out" });
  } catch (error) {
    logError("auth", error);
    res.status(500).json({ success: false, message: "Internal server error" });
  }
};

module.exports = { register, login, getProfile, getDashboard, logout };
