const express = require("express");
const router = express.Router();
const { protect } = require("../middleware/auth");
const {
  createService,
  getAllServices,
  getServiceById,
  updateService,
  deleteService,
} = require("../controllers/serviceController");

router.post("/", protect, createService);
router.get("/", getAllServices);
router.get("/:id", getServiceById);
router.put("/:id", protect, updateService);
router.delete("/:id", protect, deleteService);

module.exports = router;
