const { DataTypes } = require('sequelize');
const { sequelize } = require('../config/database');

const AuditNotification = sequelize.define('AuditNotification', {
  id: {
    type: DataTypes.UUID,
    defaultValue: DataTypes.UUIDV4,
    primaryKey: true
  },
  auditPlanId: {
    type: DataTypes.UUID,
    allowNull: true,
    references: {
      model: 'audit_plans',
      key: 'id'
    }
  },
  auditeeUserId: {
    type: DataTypes.UUID,
    allowNull: false,
    references: {
      model: 'users',
      key: 'id'
    }
  },
  createdBy: {
    type: DataTypes.UUID,
    allowNull: false,
    references: {
      model: 'users',
      key: 'id'
    }
  },
  title: {
    type: DataTypes.STRING,
    allowNull: false,
    validate: {
      notEmpty: { msg: 'Title is required' },
      len: { args: [3, 200], msg: 'Title must be between 3 and 200 characters' }
    }
  },
  notificationType: {
    type: DataTypes.ENUM('opening_meeting', 'closing_meeting', 'fieldwork_notice', 'document_deadline', 'general'),
    allowNull: false,
    defaultValue: 'opening_meeting'
  },
  badgeLabel: {
    type: DataTypes.STRING,
    allowNull: true
  },
  scheduledAt: {
    type: DataTypes.DATE,
    allowNull: false
  },
  locationOrMode: {
    type: DataTypes.STRING,
    allowNull: true
  },
  message: {
    type: DataTypes.TEXT,
    allowNull: true
  },
  status: {
    type: DataTypes.ENUM('scheduled', 'cancelled', 'completed'),
    allowNull: false,
    defaultValue: 'scheduled'
  },
  responseStatus: {
    type: DataTypes.ENUM('pending', 'confirmed', 'change_requested', 'declined'),
    allowNull: false,
    defaultValue: 'pending'
  },
  responseComment: {
    type: DataTypes.TEXT,
    allowNull: true
  },
  proposedScheduledAt: {
    type: DataTypes.DATE,
    allowNull: true
  },
  respondedAt: {
    type: DataTypes.DATE,
    allowNull: true
  },
  lastReminderAt: {
    type: DataTypes.DATE,
    allowNull: true
  },
  isActive: {
    type: DataTypes.BOOLEAN,
    allowNull: false,
    defaultValue: true
  },
  metadata: {
    type: DataTypes.JSONB,
    defaultValue: {}
  }
}, {
  tableName: 'audit_notifications',
  indexes: [
    { fields: ['auditPlanId'] },
    { fields: ['auditeeUserId'] },
    { fields: ['createdBy'] },
    { fields: ['notificationType'] },
    { fields: ['scheduledAt'] },
    { fields: ['responseStatus'] },
    { fields: ['status'] },
    { fields: ['isActive'] }
  ]
});

AuditNotification.associate = (models) => {
  AuditNotification.belongsTo(models.User, {
    foreignKey: 'auditeeUserId',
    as: 'auditee',
    onDelete: 'CASCADE',
    onUpdate: 'CASCADE'
  });

  AuditNotification.belongsTo(models.User, {
    foreignKey: 'createdBy',
    as: 'creator',
    onDelete: 'CASCADE',
    onUpdate: 'CASCADE'
  });

  if (models.AuditPlan) {
    AuditNotification.belongsTo(models.AuditPlan, {
      foreignKey: 'auditPlanId',
      as: 'auditPlan',
      onDelete: 'SET NULL',
      onUpdate: 'CASCADE'
    });
  }

  if (models.Notification) {
    AuditNotification.hasMany(models.Notification, {
      foreignKey: 'auditNotificationId',
      as: 'notifications',
      onDelete: 'SET NULL',
      onUpdate: 'CASCADE'
    });
  }
};

module.exports = AuditNotification;
