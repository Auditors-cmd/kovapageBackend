const { DataTypes } = require('sequelize');
const { sequelize } = require('../config/database');

const DashboardShare = sequelize.define('DashboardShare', {
  id: {
    type: DataTypes.UUID,
    defaultValue: DataTypes.UUIDV4,
    primaryKey: true
  },
  dashboardId: {
    type: DataTypes.UUID,
    allowNull: false,
    references: {
      model: 'monitoring_dashboards',
      key: 'id'
    }
  },
  userId: {
    type: DataTypes.UUID,
    allowNull: false,
    references: {
      model: 'users',
      key: 'id'
    }
  },
  permissions: {
    type: DataTypes.ENUM('view', 'edit', 'admin'),
    defaultValue: 'view'
  },
  sharedAt: {
    type: DataTypes.DATE,
    defaultValue: DataTypes.NOW
  }
}, {
  tableName: 'dashboard_shares',
  indexes: [
    {
      unique: true,
      fields: ['dashboardId', 'userId']
    }
  ]
});

module.exports = DashboardShare;