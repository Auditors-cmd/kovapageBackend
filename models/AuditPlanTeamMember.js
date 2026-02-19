const { DataTypes } = require('sequelize');
const { sequelize } = require('../config/database');

const AuditPlanTeamMember = sequelize.define('AuditPlanTeamMember', {
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
  userId: {
    type: DataTypes.UUID,
    allowNull: false,
    references: {
      model: 'users',
      key: 'id'
    }
  },
  role: {
    type: DataTypes.ENUM('lead', 'member', 'observer'),
    defaultValue: 'member'
  },
  assignedAt: {
    type: DataTypes.DATE,
    defaultValue: DataTypes.NOW
  }
}, {
  tableName: 'audit_plan_team_members',
  indexes: [
    {
      unique: true,
      fields: ['auditPlanId', 'userId']
    }
  ]
});

module.exports = AuditPlanTeamMember;