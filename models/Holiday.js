const { DataTypes } = require("sequelize");
const { sequelize } = require("../config/db");

const Holiday = sequelize.define(
  "Holiday",
  {
    id: {
      type: DataTypes.INTEGER,
      primaryKey: true,
      autoIncrement: true,
    },
    date: {
      type: DataTypes.DATEONLY,
      allowNull: false,
    },
    reason: {
      type: DataTypes.STRING,
      allowNull: true,
    },
    morning_close: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: false,
    },
    evening_close: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: false,
    },
  },
  {
    timestamps: true,
  }
);

module.exports = Holiday;
