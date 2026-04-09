const { DataTypes } = require('sequelize');
const { sequelize } = require('../config/database');

const HistoricalRiskScore = sequelize.define('HistoricalRiskScore', {
  id: {
    type: DataTypes.UUID,
    defaultValue: DataTypes.UUIDV4,
    primaryKey: true
  },
  unitName: {
    type: DataTypes.STRING,
    allowNull: false,
    validate: {
      notEmpty: { msg: 'Unit name is required' }
    }
  },
  classification: {
    type: DataTypes.STRING,
    allowNull: true
  },
  auditResponsibleUnit: {
    type: DataTypes.STRING,
    allowNull: true
  },
  operationalRiskScore: {
    type: DataTypes.FLOAT,
    allowNull: true
  },
  riskRating: {
    type: DataTypes.STRING,
    allowNull: true
  },
  currentAuditScore: {
    type: DataTypes.FLOAT,
    allowNull: true
  },
  auditPeriod: {
    type: DataTypes.STRING,
    allowNull: true
  },
  sourceYear: {
    type: DataTypes.INTEGER,
    allowNull: true
  },
  sourceQuarter: {
    type: DataTypes.STRING,
    allowNull: true
  },
  batchId: {
    type: DataTypes.STRING,
    allowNull: false
  },
  originalFileName: {
    type: DataTypes.STRING,
    allowNull: true
  },
  notes: {
    type: DataTypes.TEXT,
    allowNull: true
  },
  metadata: {
    type: DataTypes.JSONB,
    defaultValue: {}
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
  }
}, {
  tableName: 'historical_risk_scores',
  indexes: [
    { fields: ['unitName'] },
    { fields: ['sourceYear'] },
    { fields: ['batchId'] },
    { fields: ['createdBy'] }
  ]
});

HistoricalRiskScore.associate = (models) => {
  HistoricalRiskScore.belongsTo(models.User, {
    foreignKey: 'createdBy',
    as: 'creator'
  });

  HistoricalRiskScore.belongsTo(models.User, {
    foreignKey: 'updatedBy',
    as: 'updater'
  });
};

module.exports = HistoricalRiskScore;
