const express = require("express");
const router = express.Router();
const { protect } = require("../middleware/auth");
const {
  createOrder,
  verifyPayment,
  getMyPayments,
  getPaymentById,
} = require("../controllers/paymentController");

router.post("/create-order",  createOrder);
router.post("/verify",  verifyPayment);
router.get("/my-payments", protect, getMyPayments);
router.get("/:id", protect, getPaymentById);

module.exports = router;
