const { logError } = require("../utils/logger");
const { Op } = require("sequelize");
const Razorpay = require("razorpay");
const crypto = require("crypto");
const Transaction = require("../models/Transaction");
const Appointment = require("../models/Appointment");
const User = require("../models/User");
const Services = require("../models/Service");

const razorpay = new Razorpay({
  key_id: process.env.RAZORPAY_KEY_ID,
  key_secret: process.env.RAZORPAY_KEY_SECRET,
});

// Only allow callback URLs on our own frontend origins (CORS_ORIGINS)
const isAllowedCallback = (url) => {
  if (!url) return false;
  try {
    const allowed = (process.env.CORS_ORIGINS || "")
      .split(",")
      .map((o) => o.trim())
      .filter(Boolean);
    return allowed.includes(new URL(url).origin);
  } catch (e) {
    return false;
  }
};

// @desc    Create Razorpay order
// @route   POST /api/payments/create-order
// @access  Private (User)
const createOrder = async (req, res) => {
  try {
    const { appointment_id, amount, notes } = req.body;

    if (!appointment_id || !amount) {
      return res.status(400).json({
        success: false,
        message: "appointment_id and amount are required",
      });
    }

    const appointment = await Appointment.findOne({
      where: { id: appointment_id },
    });

    // Not found and not-yours are indistinguishable to the caller
    if (!appointment || (req.user.role !== "admin" && appointment.user_id !== req.user.id)) {
      return res.status(404).json({
        success: false,
        message: "Appointment not found",
      });
    }

    // Amount must match a real service price (never trust the client amount)
    const service = await Services.findOne({ where: { service_charge: amount } });
    if (!service) {
      return res.status(400).json({
        success: false,
        message: "Invalid service charge amount",
      });
    }

    // Check if a completed transaction already exists
    const existing = await Transaction.findOne({
      where: { appointment_id, status: "completed" },
    });
    if (existing) {
      return res.status(400).json({
        success: false,
        message: "Payment already completed for this appointment",
      });
    }

    // Create Razorpay order
    const options = {
      amount: Math.round(amount * 100), // amount in paise
      currency: "INR",
      receipt: `receipt_appt_${appointment_id}_${Date.now()}`,
      notes: {
        appointment_id: String(appointment_id),
        user_id: String(appointment.user_id),
      },
    };

    const order = await razorpay.orders.create(options);

    // Create a pending transaction
    const transaction = await Transaction.create({
      user_id: appointment.user_id,
      appointment_id,
      amount,
      payment_method: "razorpay",
      status: "pending",
      razorpay_order_id: order.id,
      notes,
    });

    res.status(200).json({
      success: true,
      message: "Order created successfully",
      data: {
        order_id: order.id,
        amount: order.amount,
        currency: order.currency,
        transaction_id: transaction.id,
        key_id: process.env.RAZORPAY_KEY_ID,
      },
    });
  } catch (error) {
    logError("payment", error);
    res.status(500).json({ status: 500, message: "Internal server error" });
  }
};

// @desc    Verify Razorpay payment
// @route   POST /api/payments/verify
// @access  Private (User)
const verifyPayment = async (req, res) => {
  try {
    const { razorpay_order_id, razorpay_payment_id, razorpay_signature } = req.body;

    if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature) {
      return res.status(400).json({
        success: false,
        message: "razorpay_order_id, razorpay_payment_id and razorpay_signature are required",
      });
    }

    // Verify signature
    const body = razorpay_order_id + "|" + razorpay_payment_id;
    const expectedSignature = crypto
      .createHmac("sha256", process.env.RAZORPAY_KEY_SECRET)
      .update(body)
      .digest("hex");

    const expectedBuf = Buffer.from(expectedSignature);
    const givenBuf = Buffer.from(String(razorpay_signature));
    if (
      expectedBuf.length !== givenBuf.length ||
      !crypto.timingSafeEqual(expectedBuf, givenBuf)
    ) {
      return res.status(400).json({
        success: false,
        message: "Payment verification failed. Invalid signature.",
      });
    }

    // Update transaction as completed
    const transaction = await Transaction.findOne({
      where: { razorpay_order_id },
    });

    if (!transaction || (req.user.role !== "admin" && transaction.user_id !== req.user.id)) {
      return res.status(404).json({
        success: false,
        message: "Transaction not found",
      });
    }

    transaction.razorpay_payment_id = razorpay_payment_id;
    transaction.razorpay_signature = razorpay_signature;
    transaction.status = "completed";
    transaction.transaction_reference = razorpay_payment_id;
    await transaction.save();

    res.status(200).json({
      success: true,
      message: "Payment verified successfully",
      data: transaction,
    });
  } catch (error) {
    logError("payment", error);
    res.status(500).json({ status: 500, message: "Internal server error" });
  }
};

// @desc    Get payment history for logged-in user
// @route   GET /api/payments/my-payments
// @access  Private (User)
const getMyPayments = async (req, res) => {
  try {
    const { status } = req.query;
    const page = Math.max(parseInt(req.query.page) || 1, 1);
    const limit = Math.min(Math.max(parseInt(req.query.limit) || 10, 1), 100);
    const offset = (page - 1) * limit;

    const where = { user_id: req.user.id };
    if (status) where.status = status;

    const { count, rows } = await Transaction.findAndCountAll({
      where,
      include: [
        {
          model: Appointment,
          as: "appointment",
        },
      ],
      limit,
      offset,
      order: [["createdAt", "DESC"]],
    });

    res.status(200).json({
      success: true,
      message: "Payment history retrieved successfully",
      data: {
        data: rows,
        total: count,
        current_page: page,
        last_page: Math.ceil(count / limit),
        per_page: limit,
      },
    });
  } catch (error) {
    logError("payment", error);
    res.status(500).json({ status: 500, message: "Internal server error" });
  }
};

// @desc    Get payment details by transaction ID
// @route   GET /api/payments/:id
// @access  Private (User)
const getPaymentById = async (req, res) => {
  try {
    const { id } = req.params;

    const transaction = await Transaction.findOne({
      where: { id, user_id: req.user.id },
      include: [
        {
          model: Appointment,
          as: "appointment",
        },
      ],
    });

    if (!transaction) {
      return res.status(404).json({
        success: false,
        message: "Payment not found",
      });
    }

    res.status(200).json({
      success: true,
      message: "Payment details retrieved successfully",
      data: transaction,
    });
  } catch (error) {
    logError("payment", error);
    res.status(500).json({ status: 500, message: "Internal server error" });
  }
};

// @desc    Create Razorpay payment link
// @route   POST /api/payments/create-payment-link
// @access  Private (User)
const createPaymentLink = async (req, res) => {
  try {
    const { amount, customer_name, customer_email, customer_contact, description, notes, callback_url } = req.body || {};

    if (
      (customer_name != null && (typeof customer_name !== "string" || customer_name.length > 100)) ||
      (customer_email != null && customer_email !== "" && !(typeof customer_email === "string" && customer_email.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(customer_email))) ||
      (customer_contact != null && customer_contact !== "" && !/^[0-9+\-\s]{7,15}$/.test(String(customer_contact))) ||
      (description != null && (typeof description !== "string" || description.length > 255)) ||
      (notes != null && JSON.stringify(notes).length > 1000)
    ) {
      return res.status(400).json({ success: false, message: "Invalid input" });
    }

    if (!amount) {
      return res.status(400).json({
        success: false,
        message: "amount is required",
      });
    }

    const service = await Services.findOne({
      where: { service_charge: amount },
    });

    if (!service) {
      return res.status(400).json({
        success: false,
        message: "Invalid service charge amount",
      });
    }


    const paymentLinkOptions = {
      amount: Math.round(amount * 100), // amount in paise
      currency: "INR",
      description: description || `Payment for Appointment #${Date.now()}`,
      customer: {
        name: customer_name || "",
        email: customer_email || "",
        contact: customer_contact || "",
      },
      // Notifications are OFF: this endpoint is public, and notify would let
      // anyone trigger billable SMS/email to arbitrary numbers/addresses.
      // The customer pays via the returned short_url.
      notify: {
        sms: false,
        email: false,
      },
      reminder_enable: false,
      expire_by: Math.floor(Date.now() / 1000) + 24 * 60 * 60,
      callback_url: isAllowedCallback(callback_url)
        ? callback_url
        : process.env.RAZORPAY_CALLBACK_URL || "",
      callback_method: "get",
    };

    // Opportunistic cleanup of abandoned, never-claimed link transactions
    await Transaction.destroy({
      where: {
        payment_method: "razorpay_payment_link",
        status: "pending",
        appointment_id: null,
        createdAt: { [Op.lt]: new Date(Date.now() - 48 * 60 * 60 * 1000) },
      },
    });

    const paymentLink = await razorpay.paymentLink.create(paymentLinkOptions);

    // Create a pending transaction
    const transaction = await Transaction.create({
      amount,
      payment_method: "razorpay_payment_link",
      status: "pending",
      razorpay_order_id: paymentLink.id,
      notes: JSON.stringify(notes),
    });

    res.status(200).json({
      success: true,
      message: "Payment link created successfully",
      data: {
        payment_link_id: paymentLink.id,
        payment_link_url: paymentLink.short_url,
        amount: paymentLink.amount,
        currency: paymentLink.currency,
        transaction_id: transaction.id,
      },
    });
  } catch (error) {
    logError("payment", error);
    res.status(500).json({ status: 500, message: "Internal server error" });
  }
};

module.exports = {
  createOrder,
  verifyPayment,
  getMyPayments,
  getPaymentById,
  createPaymentLink,
};
