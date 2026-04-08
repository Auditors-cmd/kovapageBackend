const { DataTypes } = require('sequelize');
const { sequelize } = require('../config/database');

const AnnualAuditPlan = sequelize.define('AnnualAuditPlan', {
  id: {
    type: DataTypes.UUID,
    defaultValue: DataTypes.UUIDV4,
    primaryKey: true
  },
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
  year: {
    type: DataTypes.INTEGER,
    allowNull: false,
    validate: {
      min: 2000,
      max: 2100
    }
  },
  status: {
    type: DataTypes.ENUM(
      'draft',
      'under_review',
      'qa_approved',
      'qa_rejected',
      'cae_approved',
      'cae_rejected',
      'board_pending',
      'board_approved',
      'board_rejected',
      'published',
      'archived'
    ),
    defaultValue: 'draft'
  },
  scope: {
    type: DataTypes.TEXT,
    allowNull: true
  },
  executiveSummary: {
    type: DataTypes.TEXT,
    allowNull: true
  },
  riskMethodology: {
    type: DataTypes.TEXT,
    allowNull: true
  },
  assumptions: {
    type: DataTypes.TEXT,
    allowNull: true
  },
  changeControlNotes: {
    type: DataTypes.TEXT,
    allowNull: true
  },
  approvalNotes: {
    type: DataTypes.TEXT,
    allowNull: true
  },
  sections: {
    type: DataTypes.JSONB,
    defaultValue: []
  },
  version: {
    type: DataTypes.INTEGER,
    defaultValue: 1,
    validate: { min: 1 }
  },
  currency: {
    type: DataTypes.STRING,
    defaultValue: 'NGN'
  },
  createdBy: {
    type: DataTypes.UUID,
    allowNull: false,
    references: {
      model: 'users',
      key: 'id'
    }
  },
  updatedBy: {
    type: DataTypes.UUID,
    allowNull: true,
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
  },
  publishedAt: {
    type: DataTypes.DATE,
    allowNull: true
  },
  metadata: {
    type: DataTypes.JSONB,
    defaultValue: {}
  }
}, {
  tableName: 'annual_audit_plans',
  indexes: [
    { fields: ['planNumber'], unique: true },
    { fields: ['year'] },
    { fields: ['status'] },
    { fields: ['createdBy'] },
    { fields: ['approvedBy'] }
  ]
});

AnnualAuditPlan.associate = (models) => {
  AnnualAuditPlan.belongsTo(models.User, {
    foreignKey: 'createdBy',
    as: 'creator',
    onDelete: 'SET NULL',
    onUpdate: 'CASCADE'
  });

  AnnualAuditPlan.belongsTo(models.User, {
    foreignKey: 'updatedBy',
    as: 'updater',
    onDelete: 'SET NULL',
    onUpdate: 'CASCADE'
  });

  AnnualAuditPlan.belongsTo(models.User, {
    foreignKey: 'approvedBy',
    as: 'approver',
    onDelete: 'SET NULL',
    onUpdate: 'CASCADE'
  });
};

module.exports = AnnualAuditPlan;
