const express = require("express");
const router = express.Router();
const { protect, admin } = require("../middleware/auth");
const {
  createService,
  getAllServices,
  getServiceById,
  updateService,
  deleteService,
} = require("../controllers/serviceController");

router.post("/", protect, admin, createService);
router.get("/", getAllServices);
router.get("/:id", getServiceById);
router.put("/:id", protect, admin, updateService);
router.delete("/:id", protect, admin, deleteService);

module.exports = router;
