const { DataTypes } = require('sequelize');
const { sequelize } = require('../config/database');

const Notification = sequelize.define('Notification', {
  id: {
    type: DataTypes.UUID,
    defaultValue: DataTypes.UUIDV4,
    primaryKey: true
  },
  userId: {
    type: DataTypes.UUID,
    allowNull: false,
    references: {
      model: 'users',
      key: 'id'
    }
  },
  auditPlanId: {
    type: DataTypes.UUID,
    allowNull: true,
    references: {
      model: 'audit_plans',
      key: 'id'
    }
  },
  type: {
    type: DataTypes.ENUM('assignment', 'approval', 'reminder', 'system'),
    defaultValue: 'system'
  },
  title: {
    type: DataTypes.STRING,
    allowNull: false
  },
  message: {
    type: DataTypes.TEXT,
    allowNull: false
  },
  status: {
    type: DataTypes.ENUM('unread', 'read'),
    defaultValue: 'unread'
  },
  metadata: {
    type: DataTypes.JSONB,
    defaultValue: {}
  }
}, {
  tableName: 'notifications',
  indexes: [
    {
      fields: ['userId']
    },
    {
      fields: ['status']
    },
    {
      fields: ['type']
    },
    {
      fields: ['createdAt']
    }
  ]
});

Notification.associate = (models) => {
  Notification.belongsTo(models.User, {
    foreignKey: 'userId',
    as: 'recipient',
    onDelete: 'CASCADE',
    onUpdate: 'CASCADE'
  });

  Notification.belongsTo(models.AuditPlan, {
    foreignKey: 'auditPlanId',
    as: 'auditPlan',
    onDelete: 'SET NULL',
    onUpdate: 'CASCADE'
  });
};

module.exports = Notification;
