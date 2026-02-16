const { DataTypes } = require("sequelize");
const { sequelize } = require("../config/db");

const BlockedSlot = sequelize.define(
  "BlockedSlot",
  {
    id: {
      type: DataTypes.INTEGER,
      primaryKey: true,
      autoIncrement: true,
    },
    blocked_date: {
      type: DataTypes.DATEONLY,
      allowNull: false,
    },
    is_full_day: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: true,
    },
    reason: {
      type: DataTypes.STRING,
      allowNull: true,
    },
  },
  {
    timestamps: true,
  }
);

module.exports = BlockedSlot;
