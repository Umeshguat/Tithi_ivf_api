const express = require("express");
const router = express.Router();
const { protect, admin } = require("../middleware/auth");
const {
  createHoliday,
  getAllHolidays,
  getHolidayById,
  updateHoliday,
  deleteHoliday,
} = require("../controllers/holidayController");

router.post("/", protect, admin, createHoliday);
router.get("/", getAllHolidays);
router.get("/:id", getHolidayById);
router.post("/update", protect, admin, updateHoliday);
router.delete("/:id", protect, admin, deleteHoliday);

module.exports = router;
