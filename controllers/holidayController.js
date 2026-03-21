const Holiday = require("../models/Holiday");

// Create a new holiday
const createHoliday = async (req, res, next) => {
  try {
    const { date, reason, morning_close, evening_close } = req.body;

    if (!date) {
      return res.status(400).json({ message: "date is required" });
    }

    const holiday = await Holiday.create({ date, reason, morning_close, evening_close });
    res.status(201).json({ success: 201, message: "Holiday created successfully", data: holiday });
  } catch (error) {
    next(error);
  }
};

// Get all holidays
const getAllHolidays = async (req, res, next) => {
  try {
    const holidays = await Holiday.findAll({ order: [["date", "ASC"]] });
    res.status(200).json({ success: 200, message: "Holidays fetched successfully", data: holidays });
  } catch (error) {
    next(error);
  }
};

// Get a single holiday by ID
const getHolidayById = async (req, res, next) => {
  try {
    const holiday = await Holiday.findByPk(req.params.id);

    if (!holiday) {
      return res.status(404).json({ message: "Holiday not found" });
    }

    res.status(200).json({ success: 200, message: "Holiday fetched successfully", data: holiday });
  } catch (error) {
    next(error);
  }
};

// Update a holiday
const updateHoliday = async (req, res, next) => {
  try {
    const { id, date, reason, morning_close, evening_close } = req.body;

    if (!id) {
      return res.status(400).json({ message: "id is required" });
    }

    const holiday = await Holiday.findByPk(id);

    if (!holiday) {
      return res.status(404).json({ message: "Holiday not found" });
    }

    await holiday.update({ date, reason, morning_close, evening_close });

    res.status(200).json({ success: 200, message: "Holiday updated successfully", data: holiday });
  } catch (error) {
    next(error);
  }
};

// Delete a holiday
const deleteHoliday = async (req, res, next) => {
  try {
    const holiday = await Holiday.findByPk(req.params.id);

    if (!holiday) {
      return res.status(404).json({ message: "Holiday not found" });
    }

    await holiday.destroy();
    res.status(200).json({ success: 200, message: "Holiday deleted successfully" });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  createHoliday,
  getAllHolidays,
  getHolidayById,
  updateHoliday,
  deleteHoliday,
};
