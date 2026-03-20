const { DataTypes } = require('sequelize');
const { sequelize } = require('../config/database');

const AuditAssignmentTask = sequelize.define('AuditAssignmentTask', {
  id: {
    type: DataTypes.UUID,
    defaultValue: DataTypes.UUIDV4,
    primaryKey: true
  },
  auditPlanId: {
    type: DataTypes.UUID,
    allowNull: false,
    references: {
      model: 'audit_plans',
      key: 'id'
    }
  },
  assigneeId: {
    type: DataTypes.UUID,
    allowNull: false,
    references: {
      model: 'users',
      key: 'id'
    }
  },
  assignedBy: {
    type: DataTypes.UUID,
    allowNull: false,
    references: {
      model: 'users',
      key: 'id'
    }
  },
  assignmentRole: {
    type: DataTypes.ENUM('team_lead', 'team_member'),
    allowNull: false
  },
  taskType: {
    type: DataTypes.ENUM('audit_assignment'),
    defaultValue: 'audit_assignment'
  },
  status: {
    type: DataTypes.ENUM('pending', 'in_progress', 'completed', 'cancelled', 'reassigned'),
    defaultValue: 'pending'
  },
  dueDate: {
    type: DataTypes.DATE,
    allowNull: true
  },
  isActive: {
    type: DataTypes.BOOLEAN,
    defaultValue: true
  },
  metadata: {
    type: DataTypes.JSONB,
    defaultValue: {}
  }
}, {
  tableName: 'audit_assignment_tasks',
  indexes: [
    {
      fields: ['auditPlanId']
    },
    {
      fields: ['assigneeId']
    },
    {
      fields: ['status']
    },
    {
      fields: ['isActive']
    }
  ]
});

AuditAssignmentTask.associate = (models) => {
  AuditAssignmentTask.belongsTo(models.AuditPlan, {
    foreignKey: 'auditPlanId',
    as: 'auditPlan',
    onDelete: 'CASCADE',
    onUpdate: 'CASCADE'
  });

  AuditAssignmentTask.belongsTo(models.User, {
    foreignKey: 'assigneeId',
    as: 'assignee',
    onDelete: 'CASCADE',
    onUpdate: 'CASCADE'
  });

  AuditAssignmentTask.belongsTo(models.User, {
    foreignKey: 'assignedBy',
    as: 'assigner',
    onDelete: 'SET NULL',
    onUpdate: 'CASCADE'
  });
};

module.exports = AuditAssignmentTask;
