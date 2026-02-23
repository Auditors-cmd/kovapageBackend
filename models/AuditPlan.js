const { DataTypes } = require('sequelize');
const { sequelize } = require('../config/database');

const AuditPlan = sequelize.define('AuditPlan', {
  id: {
    type: DataTypes.UUID,
    defaultValue: DataTypes.UUIDV4,
    primaryKey: true
  },
  // Plan identification
  planNumber: {
    type: DataTypes.STRING,
    allowNull: false,
    unique: true,
    validate: {
      notEmpty: { msg: 'Plan number is required' }
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
  description: {
    type: DataTypes.TEXT,
    allowNull: true
  },
  // Status
  status: {
    type: DataTypes.ENUM('draft', 'under_review', 'approved', 'consolidated', 'implemented'),
    defaultValue: 'draft'
  },
  // NEW: Department field for filtering
  department: {
    type: DataTypes.STRING,
    allowNull: true,
    comment: 'Department associated with this audit plan',
    validate: {
      len: {
        args: [0, 100],
        msg: 'Department must be less than 100 characters'
      }
    }
  },
  // Planning details
  auditPeriod: {
    type: DataTypes.STRING,
    allowNull: true,
    comment: 'e.g., Q1 2024, FY 2024'
  },
  startDate: {
    type: DataTypes.DATE,
    allowNull: true
  },
  endDate: {
    type: DataTypes.DATE,
    allowNull: true
  },
  // Risk Assessment Reference
  riskAssessmentId: {
    type: DataTypes.UUID,
    allowNull: true,
    references: {
      model: 'risk_assessments',
      key: 'id'
    }
  },
  // Consolidation
  isConsolidated: {
    type: DataTypes.BOOLEAN,
    defaultValue: false
  },
  consolidatedFrom: {
    type: DataTypes.ARRAY(DataTypes.UUID),
    defaultValue: [],
    comment: 'Array of plan IDs that were consolidated into this one'
  },
  // Team assignments
  teamLeadId: {
    type: DataTypes.UUID,
    allowNull: true,
    references: {
      model: 'users',
      key: 'id'
    }
  },
  teamMemberIds: {
    type: DataTypes.ARRAY(DataTypes.UUID),
    defaultValue: []
  },
  // Resources
  budget: {
    type: DataTypes.FLOAT,
    allowNull: true
  },
  resourceHours: {
    type: DataTypes.INTEGER,
    allowNull: true
  },
  // Audit areas/findings
  auditAreas: {
    type: DataTypes.JSONB,
    defaultValue: [],
    comment: 'List of audit areas to be covered'
  },
  // Progress
  progressPercentage: {
    type: DataTypes.FLOAT,
    defaultValue: 0,
    validate: { min: 0, max: 100 }
  },
  // Audit fields
  createdBy: {
    type: DataTypes.UUID,
    allowNull: false,
    references: {
      model: 'users',
      key: 'id'
    }
  },
  approvedBy: {
    type: DataTypes.UUID,
    allowNull: true,
    references: {
      model: 'users',
      key: 'id'
    }
  },
  approvedAt: {
    type: DataTypes.DATE,
    allowNull: true
  }
}, {
  tableName: 'audit_plans',
  indexes: [
    {
      fields: ['planNumber'],
      unique: true
    },
    {
      fields: ['status']
    },
    {
      fields: ['riskAssessmentId']
    },
    {
      fields: ['teamLeadId']
    },
    // NEW: Add index for department for better performance
    {
      fields: ['department']
    }
  ]
});

// =======================
// ASSOCIATIONS
// =======================
AuditPlan.associate = (models) => {
  // An audit plan belongs to the user who created it
  AuditPlan.belongsTo(models.User, {
    foreignKey: 'createdBy',
    as: 'creator',
    onDelete: 'SET NULL',
    onUpdate: 'CASCADE'
  });

  // An audit plan belongs to the team lead
  AuditPlan.belongsTo(models.User, {
    foreignKey: 'teamLeadId',
    as: 'teamLead',
    onDelete: 'SET NULL',
    onUpdate: 'CASCADE'
  });

  // An audit plan belongs to the user who approved it
  AuditPlan.belongsTo(models.User, {
    foreignKey: 'approvedBy',
    as: 'approver',
    onDelete: 'SET NULL',
    onUpdate: 'CASCADE'
  });

  // An audit plan belongs to a risk assessment
  AuditPlan.belongsTo(models.RiskAssessment, {
    foreignKey: 'riskAssessmentId',
    as: 'riskAssessment',
    onDelete: 'SET NULL',
    onUpdate: 'CASCADE'
  });

  // An audit plan can have many team members (many-to-many)
  AuditPlan.belongsToMany(models.User, {
    through: 'audit_plan_team_members',
    foreignKey: 'auditPlanId',
    otherKey: 'userId',
    as: 'teamMembers'
  });

  // An audit plan can be consolidated from multiple other plans
  AuditPlan.hasMany(AuditPlan, {
    foreignKey: 'consolidatedFrom',
    as: 'sourcePlans',
    constraints: false
  });

  // An audit plan can be the source for consolidated plans
  AuditPlan.belongsToMany(AuditPlan, {
    through: 'audit_plan_consolidations',
    as: 'consolidatedInto',
    foreignKey: 'sourcePlanId',
    otherKey: 'consolidatedPlanId'
  });
};

module.exports = AuditPlan;