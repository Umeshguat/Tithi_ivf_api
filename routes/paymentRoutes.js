const express = require("express");
const router = express.Router();
const { protect, admin } = require("../middleware/auth");
const { paymentLimiter } = require("../middleware/rateLimiter");
const {
  createOrder,
  verifyPayment,
  getMyPayments,
  getPaymentById,
  createPaymentLink,
} = require("../controllers/paymentController");

router.post("/create-order", protect, paymentLimiter, createOrder);
// Public: used by the guest booking flow (amount is validated against Service prices)
router.post("/create-payment-link", paymentLimiter, createPaymentLink);
router.post("/verify", protect, verifyPayment);
router.get("/my-payments", protect, getMyPayments);
router.get("/:id", protect, getPaymentById);

module.exports = router;
