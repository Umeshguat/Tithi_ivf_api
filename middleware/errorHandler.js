const { logError } = require("../utils/logger");

const errorHandler = (err, req, res, next) => {
  // Full details stay in server logs only
  logError("Unhandled error", err);

  const statusCode = err.status || err.statusCode || (res.statusCode === 200 ? 500 : res.statusCode);

  res.status(statusCode).json({
    success: false,
    message: statusCode >= 500 ? "Internal server error" : err.message,
  });
};

module.exports = errorHandler;
