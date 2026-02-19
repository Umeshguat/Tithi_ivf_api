const { Op } = require("sequelize");
const Appointment = require("../models/Appointment");
const Availability = require("../models/Availability");
const BlockedSlot = require("../models/BlockedSlot");
const User = require("../models/User");
const Transaction = require("../models/Transaction");


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
      status: { [Op.in]: ["pending", "confirmed"] },
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

// @desc    Create a new appointment
// @route   POST /api/appointments
const createAppointment = async (req, res) => {
  try {

    const { username, mobile, appointment_date, appointment_time, description, duration, amount, payment_method = 'Online', status, transaction_id} = req.body;

    const dayOfWeek = getDayOfWeek(appointment_date);


    
    let [user] = await User.findOrCreate({
      where: { mobile },
      defaults: { name: username, mobile },
    });
    const availability = await Availability.findOne({
      where: { day_of_week: dayOfWeek, is_active: true },
    });

    if (!availability) {
      return res.status(200).json({
        success: false,
        message: "No availability for this day",
      });
    }

    // Check if the full day is already blocked
    const isBlocked = await BlockedSlot.findOne({
      where: { blocked_date: appointment_date, is_full_day: true },
    });

    if (isBlocked) {
      return res.status(200).json({
        success: false,
        message: "This day is fully booked and not available",
      });
    }

    // Check if the requested slot is already booked
    const isSlotBooked = await Appointment.findOne({
      where: {
        appointment_date,
        appointment_time,
        status: { [Op.in]: ["pending", "confirmed"] },
      },
    });

    if (isSlotBooked) {
      return res.status(200).json({
        success: false,
        message: "This time slot is already booked",
      });
    }

    const appointment = await Appointment.create({
      user_id: user.id,
      appointment_date,
      appointment_time,
      status: "pending",
      description,
      duration,
    });

    let transaction = null;
    if (appointment) {
      transaction = await Transaction.create({
        user_id: appointment.user_id,
        appointment_id: appointment.id,
        amount,
        payment_method,
        status: status || "pending",
        transaction_reference:transaction_id,
        notes: `Payment for appointment on ${appointment_date} at ${appointment_time}`,
      });
    }


    // Auto-block the date if all slots are now booked
    await blockDateIfAllSlotsBooked(appointment_date, availability);

    res.status(200).json({
      success: true,
      message: "Appointment created successfully",
      data: transaction,
    });
  } catch (error) {
    console.error("Create appointment error:", error);
    const details = error.errors ? error.errors.map(e => e.message) : [];
    res.status(500).json({ status: 500, message: error.message, details });
  }
};

// @desc    Reschedule an appointment
// @route   PUT /api/appointments/reschedule
const rescheduleAppointment = async (req, res) => {
  try {

    const { user_id, appointment_date, appointment_time } = req.body;

    const appointment = await Appointment.findOne({
      where: { user_id: user_id },
      order: [['createdAt', 'DESC']]
    });


    if (!appointment) {
      return res.status(404).json({
        success: false,
        message: "Appointment not found",
      });
    }

    await appointment.update({
      appointment_date,
      appointment_time,
      status: "rescheduled",
    });

    res.status(200).json({
      success: true,
      message: "Appointment rescheduled successfully",
      data: appointment,
    });
  } catch (error) {
    res.status(500).json({ status: 500, message: error.message });
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
        status: { [Op.in]: ["pending", "confirmed"] },
      },
      attributes: ["appointment_time"],
    });

    const bookedSlots = bookedAppointments.map((a) => {
      const time = a.appointment_time;
      // Normalize to HH:mm:ss
      const parts = time.split(":");
      return `${parts[0].padStart(2, "0")}:${parts[1].padStart(2, "0")}:00`;
    });

    // Mark slots as available or booked
    const markSlots = (slots) => slots.map((slot) => {
      const slotStart = slot.split("-")[0] + ":00"; // "10:00-10:15" → "10:00:00"
      const isAvailable = !bookedSlots.includes(slotStart);
      return { time: slot, is_available: isAvailable };
    });

    res.status(200).json({
      date,
      morning: markSlots(morningSlots),
      evening: markSlots(eveningSlots),
    });
  } catch (error) {
    res.status(500).json({ status: 500, message: error.message });
  }
};

// @desc    Get all appointments (admin) with filters & pagination
// @route   GET /api/appointments
const getAppointments = async (req, res) => {
  try {
    const { date, status, payment_status, page = 1, limit = 10 } = req.query;
    const offset = (parseInt(page) - 1) * parseInt(limit);

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
      limit: parseInt(limit),
      offset,
      order: [["createdAt", "DESC"]],
    });

    res.status(200).json({
      success: true,
      message: "Appointments retrieved successfully",
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

// @desc    Update appointment status (admin)
// @route   PUT /api/appointments/status
const updateAppointmentStatus = async (req, res) => {
  try {
    const { appointment_id, status } = req.body;

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
    res.status(500).json({ status: 500, message: error.message });
  }
};

// @desc    Get appointment details (admin)
// @route   GET /api/appointments/:id
const getAppointmentDetails = async (req, res) => {
  try {
    const { id } = req.params;

    const appointment = await Appointment.findOne({
      where: { id },
      include: [{ model: User, as: "user" }],
    });

    if (!appointment) {
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
    res.status(500).json({ status: 500, message: error.message });
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
