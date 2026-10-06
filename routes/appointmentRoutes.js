const express = require("express");
const router = express.Router();
const {
  createAppointment,
  rescheduleAppointment,
  getAvailableSlots,
  getAppointments,
  updateAppointmentStatus,
  getAppointmentDetails,
} = require("../controllers/appointmentController");
const { protect, admin } = require("../middleware/auth");
const { publicLimiter } = require("../middleware/rateLimiter");

// Public (guest booking flow)
router.post("/", publicLimiter, createAppointment);
router.post("/available-slots", publicLimiter, getAvailableSlots);
// Guest lookup: requires booking_id AND mobile
router.post("/get-appointment-detail", publicLimiter, getAppointmentDetails);

// Authenticated
router.post("/reschedule", protect, rescheduleAppointment);

// Admin only
router.get("/", protect, admin, getAppointments);
router.put("/status", protect, admin, updateAppointmentStatus);

module.exports = router;
