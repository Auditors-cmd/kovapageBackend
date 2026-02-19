const { DataTypes } = require('sequelize');
const { sequelize } = require('../config/database');

const RiskAssessment = sequelize.define('RiskAssessment', {
  id: {
    type: DataTypes.UUID,
    defaultValue: DataTypes.UUIDV4,
    primaryKey: true
  },
  // Basic Info
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
  // Status tracking
  status: {
    type: DataTypes.ENUM('pending', 'in_progress', 'completed', 'reviewed'),
    defaultValue: 'pending',
    allowNull: false
  },
  // Risk Data
  riskData: {
    type: DataTypes.JSONB,
    defaultValue: {},
    comment: 'Stores the uploaded risk data in JSON format'
  },
  // File upload tracking
  originalFileName: {
    type: DataTypes.STRING,
    allowNull: true
  },
  fileUrl: {
    type: DataTypes.STRING,
    allowNull: true,
    comment: 'URL to uploaded file (if stored in cloud storage)'
  },
  fileSize: {
    type: DataTypes.INTEGER,
    allowNull: true,
    comment: 'File size in bytes'
  },
  // Metrics
  totalRisks: {
    type: DataTypes.INTEGER,
    defaultValue: 0,
    validate: { min: 0 }
  },
  highRiskCount: {
    type: DataTypes.INTEGER,
    defaultValue: 0,
    validate: { min: 0 }
  },
  mediumRiskCount: {
    type: DataTypes.INTEGER,
    defaultValue: 0,
    validate: { min: 0 }
  },
  lowRiskCount: {
    type: DataTypes.INTEGER,
    defaultValue: 0,
    validate: { min: 0 }
  },
  // Progress tracking
  progressPercentage: {
    type: DataTypes.FLOAT,
    defaultValue: 0,
    validate: { min: 0, max: 100 }
  },
  // Dates
  assessmentDate: {
    type: DataTypes.DATE,
    defaultValue: DataTypes.NOW
  },
  dueDate: {
    type: DataTypes.DATE,
    allowNull: true
  },
  completedAt: {
    type: DataTypes.DATE,
    allowNull: true
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
  updatedBy: {
    type: DataTypes.UUID,
    allowNull: true,
    references: {
      model: 'users',
      key: 'id'
    }
  },
  // Department/Unit
  department: {
    type: DataTypes.STRING,
    allowNull: true
  },
  // Metadata
  metadata: {
    type: DataTypes.JSONB,
    defaultValue: {}
  }
}, {
  tableName: 'risk_assessments',
  indexes: [
    {
      fields: ['status']
    },
    {
      fields: ['createdBy']
    },
    {
      fields: ['assessmentDate']
    },
    {
      fields: ['department']
    }
  ]
});

module.exports = RiskAssessment;