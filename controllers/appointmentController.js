const crypto = require("crypto");
const { Op } = require("sequelize");
const { sequelize } = require("../config/db");
const { logError } = require("../utils/logger");
const Appointment = require("../models/Appointment");
const Availability = require("../models/Availability");
const BlockedSlot = require("../models/BlockedSlot");
const User = require("../models/User");
const Transaction = require("../models/Transaction");
const Holiday = require("../models/Holiday");


// Helper: get day name from date string
const getDayOfWeek = (dateStr) => {
  const days = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  const date = new Date(dateStr);
  return days[date.getDay()];
};

// Helper: generate time slots
const generateTimeSlots = (startTime, endTime, duration) => {
  duration = parseInt(duration);
  const slots = [];

  const [startH, startM] = startTime.split(":").map(Number);
  const [endH, endM] = endTime.split(":").map(Number);

  let currentMinutes = startH * 60 + startM;
  let endMinutes = endH * 60 + endM;

  // If end time is before start time, assume next day
  if (endMinutes <= currentMinutes) {
    endMinutes += 24 * 60;
  }

  while (currentMinutes < endMinutes) {
    const slotStartH = String(Math.floor(currentMinutes / 60) % 24).padStart(2, "0");
    const slotStartM = String(currentMinutes % 60).padStart(2, "0");

    const nextMinutes = currentMinutes + duration;
    const slotEndH = String(Math.floor(nextMinutes / 60) % 24).padStart(2, "0");
    const slotEndM = String(nextMinutes % 60).padStart(2, "0");

    slots.push(`${slotStartH}:${slotStartM}-${slotEndH}:${slotEndM}`);
    currentMinutes = nextMinutes;
  }

  return slots;
};

// Helper: check if a slot is blocked
const isSlotBlocked = (slot, blockedSlots) => {
  const slotTime = slot.split("-")[0];
  const [slotH, slotM] = slotTime.split(":").map(Number);
  const slotMinutes = slotH * 60 + slotM;

  for (const blocked of blockedSlots) {
    const [blockStartH, blockStartM] = blocked.start_time.split(":").map(Number);
    const [blockEndH, blockEndM] = blocked.end_time.split(":").map(Number);
    const blockStartMinutes = blockStartH * 60 + blockStartM;
    const blockEndMinutes = blockEndH * 60 + blockEndM;

    if (slotMinutes >= blockStartMinutes && slotMinutes <= blockEndMinutes) {
      return true;
    }
  }
  return false;
};

// Helper: block date if all slots are booked
const blockDateIfAllSlotsBooked = async (date, availability) => {
  let allSlots = [];

  if (availability.morning_start_time && availability.morning_end_time) {
    allSlots = allSlots.concat(
      generateTimeSlots(availability.morning_start_time, availability.morning_end_time, availability.slot_duration)
    );
  }

  if (availability.evening_start_time && availability.evening_end_time) {
    allSlots = allSlots.concat(
      generateTimeSlots(availability.evening_start_time, availability.evening_end_time, availability.slot_duration)
    );
  }

  const bookedCount = await Appointment.count({
    where: {
      appointment_date: date,
      status: { [Op.in]: ["pending", "confirmed", "rescheduled"] },
    },
  });

  const blockedSlots = await BlockedSlot.findAll({
    where: {
      blocked_date: date,
      is_full_day: false,
    },
  });

  let blockedSlotCount = 0;
  for (const slot of allSlots) {
    if (isSlotBlocked(slot, blockedSlots)) {
      blockedSlotCount++;
    }
  }

  const totalUnavailable = bookedCount + blockedSlotCount;

  if (totalUnavailable >= allSlots.length) {
    await BlockedSlot.findOrCreate({
      where: {
        blocked_date: date,
        is_full_day: true,
      },
      defaults: {
        reason: "All slots booked",
      },
    });
  }
};

// Razorpay client (used to verify payment links server-side)
const Razorpay = require("razorpay");
const razorpay = new Razorpay({
  key_id: process.env.RAZORPAY_KEY_ID,
  key_secret: process.env.RAZORPAY_KEY_SECRET,
});

const MOBILE_RE = /^[0-9+\-\s]{7,15}$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^\d{1,2}:\d{2}(:\d{2})?(-\d{1,2}:\d{2}(:\d{2})?)?$/;

// Statuses that occupy a slot
const ACTIVE_STATUSES = ["pending", "confirmed", "rescheduled"];

// Normalize a time value (e.g. "10:00-10:15", "10:00", "10:00:00") to "HH:mm"
const normalizeStart = (time) => {
  if (!time) return "";
  const start = String(time).split("-")[0].trim();
  const [h = "0", m = "0"] = start.split(":");
  return `${h.padStart(2, "0")}:${m.padStart(2, "0")}`;
};

const isValidTime = (time) => time && time !== "00:00:00";

// Helper: all slot strings (morning + evening) for an availability row
const getAllSlots = (availability) => {
  let slots = [];
  if (isValidTime(availability.morning_start_time) && isValidTime(availability.morning_end_time)) {
    slots = slots.concat(
      generateTimeSlots(availability.morning_start_time, availability.morning_end_time, availability.slot_duration)
    );
  }
  if (isValidTime(availability.evening_start_time) && isValidTime(availability.evening_end_time)) {
    slots = slots.concat(
      generateTimeSlots(availability.evening_start_time, availability.evening_end_time, availability.slot_duration)
    );
  }
  return slots;
};

// Today's date (YYYY-MM-DD) in the clinic's timezone
const todayIST = () =>
  new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });

// Validates that a date/time is a real, free slot. MUST be called inside a
// transaction: it row-locks the day's Availability so concurrent bookings for
// the same day are serialized (prevents double booking).
// Returns { availability } on success or { message } on failure.
const checkSlot = async (date, time, t, excludeAppointmentId = null) => {
  if (date < todayIST()) {
    return { message: "Cannot book a date in the past" };
  }

  const availability = await Availability.findOne({
    where: { day_of_week: getDayOfWeek(date), is_active: true },
    transaction: t,
    lock: t.LOCK.UPDATE,
  });
  if (!availability) {
    return { message: "No availability for this day" };
  }

  const isBlocked = await BlockedSlot.findOne({
    where: { blocked_date: date, is_full_day: true },
    transaction: t,
  });
  if (isBlocked) {
    return { message: "This day is fully booked and not available" };
  }

  // The requested time must be one of the generated slots for that day
  const wanted = normalizeStart(time);
  if (!getAllSlots(availability).some((s) => normalizeStart(s) === wanted)) {
    return { message: "Invalid time slot for this day" };
  }

  const where = { appointment_date: date, status: { [Op.in]: ACTIVE_STATUSES } };
  if (excludeAppointmentId) where.id = { [Op.ne]: excludeAppointmentId };
  const taken = await Appointment.findAll({
    where,
    attributes: ["appointment_time"],
    transaction: t,
    lock: t.LOCK.UPDATE,
  });
  if (taken.some((a) => normalizeStart(a.appointment_time) === wanted)) {
    return { message: "This time slot is already booked" };
  }

  return { availability };
};

// @desc    Create a new appointment
// @route   POST /api/appointments
const createAppointment = async (req, res) => {
  let t;
  try {
    // NOTE: status / amount are intentionally NOT read from the client.
    // They are derived from the Razorpay payment link verified server-side.
    const { username, mobile, appointment_date, appointment_time, description, payment_link_id } = req.body || {};
    let { duration } = req.body || {};

    if (!username || !mobile || !appointment_date || !appointment_time) {
      return res.status(400).json({
        success: false,
        message: "username, mobile, appointment_date and appointment_time are required",
      });
    }
    if (
      typeof username !== "string" || username.trim().length === 0 || username.length > 100 ||
      !MOBILE_RE.test(String(mobile)) ||
      !DATE_RE.test(String(appointment_date)) ||
      !TIME_RE.test(String(appointment_time)) ||
      (description != null && (typeof description !== "string" || description.length > 500))
    ) {
      return res.status(400).json({ success: false, message: "Invalid input" });
    }
    if (duration != null) {
      duration = parseInt(duration, 10);
      if (!Number.isInteger(duration) || duration < 1 || duration > 240) {
        return res.status(400).json({ success: false, message: "Invalid duration" });
      }
    }

    // Verify payment with Razorpay (source of truth) before touching the DB
    let verifiedPayment = null;
    if (payment_link_id) {
      const pre = await Transaction.findOne({
        where: { razorpay_order_id: String(payment_link_id) },
      });
      if (!pre || pre.appointment_id) {
        return res.status(400).json({
          success: false,
          message: "Invalid or already used payment link",
        });
      }

      const link = await razorpay.paymentLink.fetch(String(payment_link_id));
      if (!link || link.status !== "paid") {
        return res.status(402).json({
          success: false,
          message: "Payment not completed",
        });
      }
      const paid = Array.isArray(link.payments)
        ? link.payments.find((p) => p.status === "captured") || link.payments[0]
        : null;
      verifiedPayment = {
        amount: (link.amount_paid || link.amount) / 100,
        payment_id: paid ? paid.payment_id : null,
      };
    }

    t = await sequelize.transaction();

    const slot = await checkSlot(appointment_date, appointment_time, t);
    if (slot.message) {
      await t.rollback();
      return res.status(200).json({ success: false, message: slot.message });
    }

    // Claim the payment link atomically: lock the row, re-check it is unused
    let paymentTxn = null;
    if (payment_link_id) {
      paymentTxn = await Transaction.findOne({
        where: { razorpay_order_id: String(payment_link_id) },
        transaction: t,
        lock: t.LOCK.UPDATE,
      });
      if (!paymentTxn || paymentTxn.appointment_id) {
        await t.rollback();
        return res.status(400).json({
          success: false,
          message: "Invalid or already used payment link",
        });
      }
    }

    const [user] = await User.findOrCreate({
      where: { mobile },
      defaults: { name: username.trim(), mobile },
      transaction: t,
    });

    // Guest bookings must never attach to staff accounts
    if (user.role === "admin") {
      await t.rollback();
      return res.status(400).json({ success: false, message: "Unable to book with the provided details" });
    }

    const appointment = await Appointment.create(
      {
        user_id: user.id,
        booking_id: `tmp_${crypto.randomUUID()}`,
        appointment_date,
        appointment_time,
        status: "pending",
        description,
        duration: duration || slot.availability.slot_duration,
      },
      { transaction: t }
    );

    const booking_id = `${appointment.id}${Date.now()}`;
    await appointment.update({ booking_id }, { transaction: t });

    if (paymentTxn) {
      await paymentTxn.update(
        {
          user_id: user.id,
          appointment_id: appointment.id,
          amount: verifiedPayment.amount,
          status: "completed",
          transaction_reference: verifiedPayment.payment_id,
          razorpay_payment_id: verifiedPayment.payment_id,
        },
        { transaction: t }
      );
    }

    await t.commit();

    // Auto-block the date if all slots are now booked
    await blockDateIfAllSlotsBooked(appointment_date, slot.availability);

    res.status(200).json({
      success: true,
      message: "Appointment created successfully",
      data: {
        // Echo what the caller submitted; never expose stored user data
        username: username.trim(),
        mobile,
        appointment,
        transaction: paymentTxn,
      },
    });
  } catch (error) {
    if (t && !t.finished) await t.rollback();
    logError("Create appointment error", error);
    if (error.name === "SequelizeValidationError") {
      return res.status(400).json({
        success: false,
        message: "Validation failed",
        details: error.errors.map((e) => e.message),
      });
    }
    res.status(500).json({ success: false, message: "Internal server error" });
  }
};

// @desc    Reschedule an appointment
// @route   POST /api/appointments/reschedule
const rescheduleAppointment = async (req, res) => {
  let t;
  try {
    const { user_id, appointment_date, appointment_time } = req.body || {};

    if (!DATE_RE.test(String(appointment_date)) || !TIME_RE.test(String(appointment_time))) {
      return res.status(400).json({ success: false, message: "Invalid appointment_date or appointment_time" });
    }

    // Non-admins can only reschedule their own appointment
    const targetUserId = req.user.role === "admin" && user_id ? user_id : req.user.id;

    t = await sequelize.transaction();

    const appointment = await Appointment.findOne({
      where: { user_id: targetUserId, status: { [Op.in]: ACTIVE_STATUSES } },
      order: [["createdAt", "DESC"]],
      transaction: t,
      lock: t.LOCK.UPDATE,
    });

    if (!appointment) {
      await t.rollback();
      return res.status(404).json({
        success: false,
        message: "Appointment not found",
      });
    }

    const slot = await checkSlot(appointment_date, appointment_time, t, appointment.id);
    if (slot.message) {
      await t.rollback();
      return res.status(200).json({ success: false, message: slot.message });
    }

    await appointment.update(
      {
        appointment_date,
        appointment_time,
        status: "rescheduled",
      },
      { transaction: t }
    );
    await t.commit();

    res.status(200).json({
      success: true,
      message: "Appointment rescheduled successfully",
      data: appointment,
    });
  } catch (error) {
    if (t && !t.finished) await t.rollback();
    logError("Reschedule appointment error", error);
    res.status(500).json({ success: false, message: "Internal server error" });
  }
};

// @desc    Get available slots for a date
// @route   POST /api/appointments/available-slots
const getAvailableSlots = async (req, res) => {
  try {
    const { date } = req.body;

    if (!date) {
      return res.status(400).json({ success: false, message: "Date is required" });
    }

    const dayOfWeek = getDayOfWeek(date);

    const availability = await Availability.findOne({
      where: { day_of_week: dayOfWeek, is_active: true },
    });

    if (!availability) {
      return res.status(200).json({
        message: "No availability for this day",
        slots: [],
      });
    }

    // Check if day is blocked
    const isBlocked = await BlockedSlot.findOne({
      where: { blocked_date: date, is_full_day: true },
    });

    if (isBlocked) {
      return res.status(200).json({
        message: "This day is not available",
        slots: [],
      });
    }

    // Generate time slots for morning and evening separately
    let morningSlots = [];
    let eveningSlots = [];

    const isValidTime = (time) => time && time !== "00:00:00";

    if (isValidTime(availability.morning_start_time) && isValidTime(availability.morning_end_time)) {
      morningSlots = generateTimeSlots(availability.morning_start_time, availability.morning_end_time, availability.slot_duration);
    }

    if (isValidTime(availability.evening_start_time) && isValidTime(availability.evening_end_time)) {
      eveningSlots = generateTimeSlots(availability.evening_start_time, availability.evening_end_time, availability.slot_duration);
    }

    // Get booked appointments
    const bookedAppointments = await Appointment.findAll({
      where: {
        appointment_date: date,
        status: { [Op.in]: ["pending", "confirmed", "rescheduled"] },
      },
      attributes: ["appointment_time"],
    });

    // Normalize a time value (e.g. "10:00-10:15", "10:00", "10:00:00") to "HH:mm"
    const normalizeStart = (time) => {
      if (!time) return "";
      const start = String(time).split("-")[0].trim();
      const [h = "0", m = "0"] = start.split(":");
      return `${h.padStart(2, "0")}:${m.padStart(2, "0")}`;
    };

    const bookedSlots = bookedAppointments.map((a) => normalizeStart(a.appointment_time));

    // Mark slots as available or booked
    const markSlots = (slots) => slots.map((slot) => {
      const slotStart = normalizeStart(slot);
      const isAvailable = !bookedSlots.includes(slotStart);
      return { time: slot, is_available: isAvailable };
    });

    // Get all holidays for the month of the requested date
    const requestedDate = new Date(date);
    const monthStart = new Date(requestedDate.getFullYear(), requestedDate.getMonth(), 1);
    const monthEnd = new Date(requestedDate.getFullYear(), requestedDate.getMonth() + 1, 0);

    const holidays = await Holiday.findAll({
      where: {
        date: {
          [Op.between]: [monthStart, monthEnd],
        },
      },
      order: [["date", "ASC"]],
    });

    res.status(200).json({
      date,
      morning: markSlots(morningSlots),
      evening: markSlots(eveningSlots),
      holidays,
    });
  } catch (error) {
    logError("appointment", error);
    res.status(500).json({ status: 500, message: "Internal server error" });
  }
};

// @desc    Get all appointments (admin) with filters & pagination
// @route   GET /api/appointments
const getAppointments = async (req, res) => {
  try {
    const { date, status, payment_status } = req.query;
    const page = Math.max(parseInt(req.query.page) || 1, 1);
    const limit = Math.min(Math.max(parseInt(req.query.limit) || 10, 1), 100);
    const offset = (page - 1) * limit;

    const where = {};
    if (date) {
      where.appointment_date = date;
    }
    if (status) {
      where.status = status;
    }

    const include = [
      { model: User, as: "user" },
    ];

    // Filter by payment status via transaction
    if (payment_status) {
      include.push({
        model: Transaction,
        as: "transaction",
        where: { status: payment_status },
        required: true,
      });
    } else {
      include.push({
        model: Transaction,
        as: "transaction",
        required: false,
      });
    }

    const { count, rows } = await Appointment.findAndCountAll({
      where,
      include,
      limit,
      offset,
      order: [["createdAt", "DESC"]],
    });

    res.status(200).json({
      success: true,
      message: "Appointments retrieved successfully",
      data: {
        data: rows,
        total: count,
        current_page: page,
        last_page: Math.ceil(count / limit),
        per_page: limit,
      },
    });
  } catch (error) {
    logError("appointment", error);
    res.status(500).json({ status: 500, message: "Internal server error" });
  }
};

// @desc    Update appointment status (admin)
// @route   PUT /api/appointments/status
const updateAppointmentStatus = async (req, res) => {
  try {
    const { appointment_id, status } = req.body;

    const ALLOWED_STATUSES = ["pending", "confirmed", "completed", "cancelled", "rescheduled"];
    if (!ALLOWED_STATUSES.includes(status)) {
      return res.status(400).json({ success: false, message: "Invalid status" });
    }

    const appointment = await Appointment.findByPk(appointment_id);

    if (!appointment) {
      return res.status(404).json({
        success: false,
        message: "Appointment not found",
      });
    }

    appointment.status = status;
    await appointment.save();

    res.status(200).json({
      success: true,
      message: "Appointment status updated successfully",
      data: appointment,
    });
  } catch (error) {
    logError("appointment", error);
    res.status(500).json({ status: 500, message: "Internal server error" });
  }
};

// @desc    Get appointment details (admin)
// @route   GET /api/appointments/:id
const getAppointmentDetails = async (req, res) => {
  try {
    const { booking_id, mobile } = req.body;

    if (!booking_id || !mobile) {
      return res.status(400).json({
        success: false,
        message: "booking_id and mobile are required",
      });
    }

    const appointment = await Appointment.findOne({
      where: { booking_id },
      include: [{ model: User, as: "user" }],
    });


    if (!appointment || appointment.user?.mobile !== mobile) {
      return res.status(404).json({
        success: false,
        message: "Appointment not found",
      });
    }

    res.status(200).json({
      success: true,
      message: "Appointment details retrieved successfully",
      data: appointment,
    });
  } catch (error) {
    logError("appointment", error);
    res.status(500).json({ status: 500, message: "Internal server error" });
  }
};

module.exports = {
  createAppointment,
  rescheduleAppointment,
  getAvailableSlots,
  getAppointments,
  updateAppointmentStatus,
  getAppointmentDetails,
};
