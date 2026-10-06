const express = require("express");
const router = express.Router();
const {
  createTransaction,
  getTransactions,
  getTransactionById,
  updateTransaction,
  generateInvoice,
} = require("../controllers/transactionController");
const { protect, admin } = require("../middleware/auth");

// Admin only
router.post("/", protect, admin, createTransaction);
router.get("/", protect, admin, getTransactions);
router.put("/:id", protect, admin, updateTransaction);

// Admin or the owning user (ownership checked in the controller)
router.get("/:id", protect, getTransactionById);
router.get("/:id/invoice", protect, generateInvoice);

module.exports = router;
