const express = require("express");
const router = express.Router();
const {
  createAvailability,
  getAvailabilities,
  getAvailability,
  updateAvailability,
  deleteAvailability,
} = require("../controllers/availabilityController");
const { protect, admin } = require("../middleware/auth");

router.post("/", protect, admin, createAvailability);
router.get("/", protect, admin, getAvailabilities);
router.get("/:id", protect, admin, getAvailability);
router.put("/:id", protect, admin, updateAvailability);
router.delete("/:id", protect, admin, deleteAvailability);

module.exports = router;
