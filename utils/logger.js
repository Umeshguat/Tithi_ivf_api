// Logs errors without dumping SQL, bound parameters or request data
// (Sequelize errors carry `sql` / `parameters` / `parent`, which can include PII).
const logError = (context, err) => {
  const e = err || {};
  console.error(`[${new Date().toISOString()}] ${context}: ${e.name || "Error"}: ${e.message || e}`);
  if (e.stack && process.env.NODE_ENV !== "production") console.error(e.stack);
};

module.exports = { logError };
