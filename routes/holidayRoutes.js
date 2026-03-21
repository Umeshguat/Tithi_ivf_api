const express = require("express");
const router = express.Router();
const { protect } = require("../middleware/auth");
const {
  createHoliday,
  getAllHolidays,
  getHolidayById,
  updateHoliday,
  deleteHoliday,
} = require("../controllers/holidayController");

router.post("/", protect, createHoliday);
router.get("/", getAllHolidays);
router.get("/:id", getHolidayById);
router.post("/update", protect, updateHoliday);
router.delete("/:id", protect, deleteHoliday);

module.exports = router;
