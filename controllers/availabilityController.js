const Availability = require("../models/Availability");

// @desc    Create availability
// @route   POST /api/availability
const createAvailability = async (req, res) => {
  try {
    const { day_of_week, morning_start_time, morning_end_time, evening_start_time, evening_end_time, slot_duration, is_active } = req.body;

    const existing = await Availability.findOne({ where: { day_of_week } });
    if (existing) {
      return res.status(400).json({
        success: false,
        message: `Availability for ${day_of_week} already exists`,
      });
    }

    const availability = await Availability.create({
      day_of_week,
      morning_start_time,
      morning_end_time,
      evening_start_time,
      evening_end_time,
      slot_duration,
      is_active: is_active !== undefined ? is_active : true,
    });

    res.status(201).json({
      success: true,
      message: "Availability created successfully",
      data: availability,
    });
  } catch (error) {
    res.status(500).json({ status: 500, message: error.message });
  }
};

// @desc    Get all availabilities (paginated)
// @route   GET /api/availability?page=1&limit=10
const getAvailabilities = async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const offset = (page - 1) * limit;

    const { count, rows } = await Availability.findAndCountAll({
      order: [["id", "ASC"]],
      limit,
      offset,
    });

    res.status(200).json({
      success: true,
      message: "Availabilities retrieved successfully",
      data: {
        data: rows,
        total: count,
        current_page: page,
        last_page: Math.ceil(count / limit),
      },
    });
  } catch (error) {
    res.status(500).json({ status: 500, message: error.message });
  }
};

// @desc    Get single availability
// @route   GET /api/availability/:id
const getAvailability = async (req, res) => {
  try {
    const availability = await Availability.findByPk(req.params.id);

    if (!availability) {
      return res.status(404).json({
        success: false,
        message: "Availability not found",
      });
    }

    res.status(200).json({
      success: true,
      message: "Availability retrieved successfully",
      data: availability,
    });
  } catch (error) {
    res.status(500).json({ status: 500, message: error.message });
  }
};

// @desc    Update availability
// @route   PUT /api/availability/:id
const updateAvailability = async (req, res) => {
  try {
    const availability = await Availability.findByPk(req.params.id);

    if (!availability) {
      return res.status(404).json({
        success: false,
        message: "Availability not found",
      });
    }

    const { day_of_week, morning_start_time, morning_end_time, evening_start_time, evening_end_time, slot_duration, is_active } = req.body;

    await availability.update({
      day_of_week: day_of_week || availability.day_of_week,
      morning_start_time: morning_start_time !== undefined ? morning_start_time : availability.morning_start_time,
      morning_end_time: morning_end_time !== undefined ? morning_end_time : availability.morning_end_time,
      evening_start_time: evening_start_time !== undefined ? evening_start_time : availability.evening_start_time,
      evening_end_time: evening_end_time !== undefined ? evening_end_time : availability.evening_end_time,
      slot_duration: slot_duration || availability.slot_duration,
      is_active: is_active !== undefined ? is_active : availability.is_active,
    });

    res.status(200).json({
      success: true,
      message: "Availability updated successfully",
      data: availability,
    });
  } catch (error) {
    res.status(500).json({ status: 500, message: error.message });
  }
};

// @desc    Delete availability
// @route   DELETE /api/availability/:id
const deleteAvailability = async (req, res) => {
  try {
    const availability = await Availability.findByPk(req.params.id);

    if (!availability) {
      return res.status(404).json({
        success: false,
        message: "Availability not found",
      });
    }

    await availability.destroy();

    res.status(200).json({
      success: true,
      message: "Availability deleted successfully",
    });
  } catch (error) {
    res.status(500).json({ status: 500, message: error.message });
  }
};

module.exports = {
  createAvailability,
  getAvailabilities,
  getAvailability,
  updateAvailability,
  deleteAvailability,
};
