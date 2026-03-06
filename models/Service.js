const { DataTypes } = require("sequelize");
const { sequelize } = require("../config/db");

const Service = sequelize.define(
  "Service",
  {
    id: {
      type: DataTypes.INTEGER,
      primaryKey: true,
      autoIncrement: true,
    },
    name: {
      type: DataTypes.STRING,
      allowNull: false,
    },
    service_charge: {
      type: DataTypes.DECIMAL(10, 2),
      allowNull: false,
    },
    deleted_at: {
      type: DataTypes.DATE,
      allowNull: true,
      defaultValue: null,
    },
  },
  {
    timestamps: true,
    paranoid: true,
    deletedAt: "deleted_at",
  }
);

module.exports = Service;
