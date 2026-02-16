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
const { protect } = require("../middleware/auth");

// User routes (authenticated)
router.post("/",  createAppointment);
router.post("/reschedule",  rescheduleAppointment);
router.post("/available-slots",  getAvailableSlots);

// Admin routes (authenticated)
router.get("/",  getAppointments);
router.put("/status",  updateAppointmentStatus);
router.get("/:id",  getAppointmentDetails);

module.exports = router;
