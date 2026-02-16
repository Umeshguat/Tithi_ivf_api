const path = require("path");
const fs = require("fs");
const PDFDocument = require("pdfkit");
const Transaction = require("../models/Transaction");
const Appointment = require("../models/Appointment");
const User = require("../models/User");

const INVOICES_DIR = path.join(__dirname, "..", "invoices");

// Ensure invoices directory exists
if (!fs.existsSync(INVOICES_DIR)) {
  fs.mkdirSync(INVOICES_DIR, { recursive: true });
}

// @desc    Create a new transaction
// @route   POST /api/transactions
const createTransaction = async (req, res) => {
  try {
    const { appointment_id, amount, payment_method, status, transaction_reference, notes } = req.body;

    const appointment = await Appointment.findOne({
      where: { id: appointment_id },
      include: [{ model: User, as: "user" }],
    });

    if (!appointment) {
      return res.status(404).json({
        success: false,
        message: "Appointment not found",
      });
    }

    // Check if transaction already exists for this appointment
    const existing = await Transaction.findOne({ where: { appointment_id } });
    if (existing) {
      return res.status(200).json({
        success: false,
        message: "Transaction already exists for this appointment",
      });
    }

    const transaction = await Transaction.create({
      user_id: appointment.user_id,
      appointment_id,
      amount,
      payment_method,
      status: status || "pending",
      transaction_reference,
      notes,
    });

    res.status(201).json({
      success: true,
      message: "Transaction created successfully",
      data: transaction,
    });
  } catch (error) {
    res.status(500).json({ status: 500, message: error.message });
  }
};

// @desc    Get all transactions with pagination & filters
// @route   GET /api/transactions
const getTransactions = async (req, res) => {
  try {
    const { status, payment_method, page = 1, limit = 10 } = req.query;
    const offset = (parseInt(page) - 1) * parseInt(limit);

    const where = {};
    if (status) where.status = status;
    if (payment_method) where.payment_method = payment_method;

    const { count, rows } = await Transaction.findAndCountAll({
      where,
      include: [
        {
          model: Appointment,
          as: "appointment",
          include: [{ model: User, as: "user" }],
        },
      ],
      limit: parseInt(limit),
      offset,
      order: [["createdAt", "DESC"]],
    });

    res.status(200).json({
      success: true,
      message: "Transactions retrieved successfully",
      data: {
        data: rows,
        total: count,
        current_page: parseInt(page),
        last_page: Math.ceil(count / parseInt(limit)),
        per_page: parseInt(limit),
      },
    });
  } catch (error) {
    res.status(500).json({ status: 500, message: error.message });
  }
};

// @desc    Get single transaction by ID
// @route   GET /api/transactions/:id
const getTransactionById = async (req, res) => {
  try {
    const { id } = req.params;

    const transaction = await Transaction.findOne({
      where: { id },
      include: [
        {
          model: Appointment,
          as: "appointment",
          include: [{ model: User, as: "user" }],
        },
      ],
    });

    if (!transaction) {
      return res.status(404).json({
        success: false,
        message: "Transaction not found",
      });
    }

    res.status(200).json({
      success: true,
      message: "Transaction retrieved successfully",
      data: transaction,
    });
  } catch (error) {
    res.status(500).json({ status: 500, message: error.message });
  }
};

// @desc    Update transaction status
// @route   PUT /api/transactions/:id
const updateTransaction = async (req, res) => {
  try {
    const { id } = req.params;
    const { status, payment_method, transaction_reference, notes } = req.body;

    const transaction = await Transaction.findByPk(id);

    if (!transaction) {
      return res.status(404).json({
        success: false,
        message: "Transaction not found",
      });
    }

    if (status) transaction.status = status;
    if (payment_method) transaction.payment_method = payment_method;
    if (transaction_reference) transaction.transaction_reference = transaction_reference;
    if (notes) transaction.notes = notes;

    await transaction.save();

    res.status(200).json({
      success: true,
      message: "Transaction updated successfully",
      data: transaction,
    });
  } catch (error) {
    res.status(500).json({ status: 500, message: error.message });
  }
};

// @desc    Generate invoice PDF & return download link
// @route   GET /api/transactions/:id/invoice
const generateInvoice = async (req, res) => {
  try {
    const { id } = req.params;

    const transaction = await Transaction.findOne({
      where: { id },
      include: [
        {
          model: Appointment,
          as: "appointment",
          include: [{ model: User, as: "user" }],
        },
      ],
    });

    if (!transaction) {
      return res.status(404).json({
        success: false,
        message: "Transaction not found",
      });
    }

    const appointment = transaction.appointment;
    const user = appointment.user;
    const fileName = `invoice_${transaction.id}_${Date.now()}.pdf`;
    const filePath = path.join(INVOICES_DIR, fileName);

    // Create PDF
    const doc = new PDFDocument({ size: "A4", margin: 50 });
    const stream = fs.createWriteStream(filePath);
    doc.pipe(stream);

    // --- Header ---
    doc
      .fontSize(22)
      .font("Helvetica-Bold")
      .text("Tithi IVF", { align: "center" });
    doc
      .fontSize(10)
      .font("Helvetica")
      .text("Healthcare & Fertility Clinic", { align: "center" });
    doc.moveDown(0.5);

    // Divider
    doc
      .strokeColor("#3B82F6")
      .lineWidth(2)
      .moveTo(50, doc.y)
      .lineTo(545, doc.y)
      .stroke();
    doc.moveDown(1);

    // --- Invoice Info ---
    doc.fontSize(16).font("Helvetica-Bold").text("INVOICE", { align: "center" });
    doc.moveDown(0.5);

    const invoiceDate = new Date(transaction.createdAt).toLocaleDateString("en-IN", {
      day: "2-digit",
      month: "short",
      year: "numeric",
    });

    doc.fontSize(10).font("Helvetica");
    doc.text(`Invoice No: INV-${String(transaction.id).padStart(5, "0")}`, 50);
    doc.text(`Date: ${invoiceDate}`, 50);
    doc.text(`Status: ${transaction.status.toUpperCase()}`, 50);
    doc.moveDown(1);

    // --- Patient Details ---
    doc
      .strokeColor("#E5E7EB")
      .lineWidth(1)
      .moveTo(50, doc.y)
      .lineTo(545, doc.y)
      .stroke();
    doc.moveDown(0.5);

    doc.fontSize(12).font("Helvetica-Bold").text("Patient Details");
    doc.moveDown(0.3);
    doc.fontSize(10).font("Helvetica");
    doc.text(`Name: ${user.name || "N/A"}`);
    if (user.email) doc.text(`Email: ${user.email}`);
    if (user.mobile) doc.text(`Mobile: ${user.mobile}`);
    doc.moveDown(1);

    // --- Booking Detail Summary ---
    doc
      .strokeColor("#E5E7EB")
      .lineWidth(1)
      .moveTo(50, doc.y)
      .lineTo(545, doc.y)
      .stroke();
    doc.moveDown(0.5);

    doc.fontSize(12).font("Helvetica-Bold").text("Booking Detail Summary");
    doc.moveDown(0.3);

    const appointmentDate = new Date(appointment.appointment_date).toLocaleDateString("en-IN", {
      weekday: "long",
      day: "2-digit",
      month: "short",
      year: "numeric",
    });

    doc.fontSize(10).font("Helvetica");
    doc.text(`Appointment ID: #${appointment.id}`);
    doc.text(`Date: ${appointmentDate}`);
    doc.text(`Time: ${appointment.appointment_time}`);
    doc.text(`Duration: ${appointment.duration} minutes`);
    doc.text(`Appointment Status: ${appointment.status}`);
    if (appointment.description) {
      doc.text(`Description: ${appointment.description}`);
    }
    doc.moveDown(1);

    // --- Payment Details Table ---
    doc
      .strokeColor("#E5E7EB")
      .lineWidth(1)
      .moveTo(50, doc.y)
      .lineTo(545, doc.y)
      .stroke();
    doc.moveDown(0.5);

    doc.fontSize(12).font("Helvetica-Bold").text("Payment Details");
    doc.moveDown(0.5);

    // Table header
    const tableTop = doc.y;
    doc
      .rect(50, tableTop, 495, 22)
      .fill("#3B82F6");

    doc.fontSize(10).font("Helvetica-Bold").fillColor("#FFFFFF");
    doc.text("Description", 60, tableTop + 6, { width: 200 });
    doc.text("Method", 270, tableTop + 6, { width: 100 });
    doc.text("Amount", 430, tableTop + 6, { width: 100, align: "right" });

    // Table row
    const rowTop = tableTop + 22;
    doc
      .rect(50, rowTop, 495, 22)
      .fill("#F9FAFB");

    doc.fontSize(10).font("Helvetica").fillColor("#000000");
    doc.text("Consultation Fee", 60, rowTop + 6, { width: 200 });
    doc.text(transaction.payment_method, 270, rowTop + 6, { width: 100 });
    doc.text(`Rs. ${parseFloat(transaction.amount).toFixed(2)}`, 430, rowTop + 6, { width: 100, align: "right" });

    // Total row
    const totalTop = rowTop + 30;
    doc
      .strokeColor("#E5E7EB")
      .lineWidth(1)
      .moveTo(350, totalTop)
      .lineTo(545, totalTop)
      .stroke();

    doc.fontSize(12).font("Helvetica-Bold").fillColor("#000000");
    doc.text("Total:", 350, totalTop + 6, { width: 80 });
    doc.text(`Rs. ${parseFloat(transaction.amount).toFixed(2)}`, 430, totalTop + 6, { width: 100, align: "right" });

    doc.moveDown(3);

    // Transaction reference
    if (transaction.transaction_reference) {
      doc.fontSize(9).font("Helvetica").fillColor("#6B7280");
      doc.text(`Transaction Ref: ${transaction.transaction_reference}`, 50);
    }
    if (transaction.notes) {
      doc.fontSize(9).font("Helvetica").fillColor("#6B7280");
      doc.text(`Notes: ${transaction.notes}`, 50);
    }

    // Footer
    doc.moveDown(2);
    doc
      .strokeColor("#E5E7EB")
      .lineWidth(1)
      .moveTo(50, doc.y)
      .lineTo(545, doc.y)
      .stroke();
    doc.moveDown(0.5);

    doc.fontSize(9).font("Helvetica").fillColor("#9CA3AF");
    doc.text("This is a computer-generated invoice. No signature required.", { align: "center" });
    doc.text("Thank you for choosing Tithi IVF.", { align: "center" });

    doc.end();

    stream.on("finish", () => {
      const baseUrl = `${req.protocol}://${req.get("host")}`;
      const invoiceUrl = `${baseUrl}/invoices/${fileName}`;

      res.status(200).json({
        success: true,
        message: "Invoice generated successfully",
        data: {
          invoice_url: invoiceUrl,
          transaction_id: transaction.id,
          appointment_id: appointment.id,
          patient_name: user.name,
          amount: transaction.amount,
          status: transaction.status,
          booking_summary: {
            appointment_date: appointment.appointment_date,
            appointment_time: appointment.appointment_time,
            duration: appointment.duration,
            description: appointment.description,
            appointment_status: appointment.status,
          },
        },
      });
    });

    stream.on("error", (err) => {
      res.status(500).json({ status: 500, message: err.message });
    });
  } catch (error) {
    res.status(500).json({ status: 500, message: error.message });
  }
};

module.exports = {
  createTransaction,
  getTransactions,
  getTransactionById,
  updateTransaction,
  generateInvoice,
};
