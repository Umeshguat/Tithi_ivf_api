const Service = require("../models/Service");

// Create a new service
const createService = async (req, res, next) => {
  try {
    const { name, service_charge } = req.body;

    if (!name || !service_charge) {
      return res.status(400).json({ message: "name and service_charge are required" });
    }

    const service = await Service.create({ name, service_charge });
    res.status(201).json({ success: 201, data: service });
  } catch (error) {
    next(error);
  }
};

// Get all services
const getAllServices = async (req, res, next) => {
  try {
    const services = await Service.findAll();
    res.status(200).json({ success: 200, data: services });
  } catch (error) {
    next(error);
  }
};

// Get a single service by ID
const getServiceById = async (req, res, next) => {
  try {
    const service = await Service.findByPk(req.params.id);

    if (!service) {
      return res.status(404).json({ message: "Service not found" });
    }

    res.status(200).json({ success: 200, data: service });
  } catch (error) {
    next(error);
  }
};

// Update a service
const updateService = async (req, res, next) => {
  try {
    const service = await Service.findByPk(req.params.id);

    if (!service) {
      return res.status(404).json({ message: "Service not found" });
    }

    const { name, service_charge } = req.body;
    await service.update({ name, service_charge });

    res.status(200).json({ success: true, data: service });
  } catch (error) {
    next(error);
  }
};

// Delete a service (soft delete via paranoid)
const deleteService = async (req, res, next) => {
  try {
    const service = await Service.findByPk(req.params.id);

    if (!service) {
      return res.status(404).json({ message: "Service not found" });
    }

    await service.destroy();
    res.status(200).json({ success: 200, message: "Service deleted successfully" });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  createService,
  getAllServices,
  getServiceById,
  updateService,
  deleteService,
};
