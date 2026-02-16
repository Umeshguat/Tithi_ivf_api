const { DataTypes } = require("sequelize");
const { sequelize } = require("../config/db");

const Appointment = sequelize.define(
  "Appointment",
  {
    id: {
      type: DataTypes.INTEGER,
      primaryKey: true,
      autoIncrement: true,
    },
    user_id: {
      type: DataTypes.INTEGER,
      allowNull: false,
      references: {
        model: "Users",
        key: "id",
      },
    },
    appointment_date: {
      type: DataTypes.DATEONLY,
      allowNull: false,
    },
    appointment_time: {
      type: DataTypes.TIME,
      allowNull: false,
    },
    status: {
      type: DataTypes.STRING,
      allowNull: false,
      defaultValue: "pending",
    },
    description: {
      type: DataTypes.TEXT,
      allowNull: true,
    },
    duration: {
      type: DataTypes.INTEGER,
      allowNull: false,
    },
  },
  {
    timestamps: true,
  }
);

const User = require("./User");
const Transaction = require("./Transaction");

Appointment.belongsTo(User, { foreignKey: "user_id", as: "user" });
User.hasMany(Appointment, { foreignKey: "user_id", as: "appointments" });

Appointment.hasOne(Transaction, { foreignKey: "appointment_id", as: "transaction" });
Transaction.belongsTo(Appointment, { foreignKey: "appointment_id", as: "appointment" });

module.exports = Appointment;
