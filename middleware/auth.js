const jwt = require("jsonwebtoken");
const User = require("../models/User");

const protect = async (req, res, next) => {
  let token;

  if (
    req.headers.authorization &&
    req.headers.authorization.startsWith("Bearer ")
  ) {
    token = req.headers.authorization.split(" ")[1];
  }

  if (!token) {
    return res.status(401).json({ success: false, message: "Not authorized, no token" });
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET, { algorithms: ["HS256"] });
    const user = await User.findByPk(decoded.id);
    if (!user) {
      return res.status(401).json({ success: false, message: "Not authorized, user not found" });
    }
    // Revocation: any token issued before the user's last update (password
    // change, logout) is rejected. (+1s tolerates MySQL DATETIME rounding.)
    if (user.updatedAt && Math.floor(new Date(user.updatedAt).getTime() / 1000) > decoded.iat + 1) {
      return res.status(401).json({ success: false, message: "Not authorized, token revoked" });
    }
    req.user = user;
    next();
  } catch (error) {
    return res.status(401).json({ success: false, message: "Not authorized, token invalid" });
  }
};

const admin = (req, res, next) => {
  if (req.user && req.user.role === "admin") {
    next();
  } else {
    return res.status(403).json({ success: false, message: "Not authorized, admin access only" });
  }
};

module.exports = { protect, admin };
