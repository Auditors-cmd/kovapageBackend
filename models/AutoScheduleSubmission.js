const { DataTypes } = require('sequelize');
const { sequelize } = require('../config/database');

const AutoScheduleSubmission = sequelize.define('AutoScheduleSubmission', {
  id: {
    type: DataTypes.UUID,
    defaultValue: DataTypes.UUIDV4,
    primaryKey: true
  },
  submissionId: {
    type: DataTypes.STRING,
    allowNull: false,
    unique: true
  },
  scopeDepartment: {
    type: DataTypes.STRING,
    allowNull: true
  },
  targetYear: {
    type: DataTypes.INTEGER,
    allowNull: false
  },
  status: {
    type: DataTypes.ENUM('pending_approval', 'approved', 'rejected'),
    defaultValue: 'pending_approval'
  },
  sourcePlanIds: {
    type: DataTypes.ARRAY(DataTypes.UUID),
    defaultValue: []
  },
  recommendations: {
    type: DataTypes.JSONB,
    defaultValue: []
  },
  notes: {
    type: DataTypes.TEXT,
    allowNull: true
  },
  submittedBy: {
    type: DataTypes.UUID,
    allowNull: false,
    references: {
      model: 'users',
      key: 'id'
    }
  },
  submittedByName: {
    type: DataTypes.STRING,
    allowNull: true
  },
  submittedAt: {
    type: DataTypes.DATE,
    allowNull: false,
    defaultValue: DataTypes.NOW
  },
  decidedBy: {
    type: DataTypes.UUID,
    allowNull: true,
    references: {
      model: 'users',
      key: 'id'
    }
  },
  decidedByName: {
    type: DataTypes.STRING,
    allowNull: true
  },
  decidedAt: {
    type: DataTypes.DATE,
    allowNull: true
  },
  decisionNotes: {
    type: DataTypes.TEXT,
    allowNull: true
  },
  metadata: {
    type: DataTypes.JSONB,
    defaultValue: {}
  }
}, {
  tableName: 'auto_schedule_submissions',
  indexes: [
    {
      fields: ['submissionId'],
      unique: true
    },
    {
      fields: ['status']
    },
    {
      fields: ['scopeDepartment']
    },
    {
      fields: ['targetYear']
    },
    {
      fields: ['submittedBy']
    }
  ]
});

AutoScheduleSubmission.associate = (models) => {
  AutoScheduleSubmission.belongsTo(models.User, {
    foreignKey: 'submittedBy',
    as: 'submitter',
    onDelete: 'SET NULL',
    onUpdate: 'CASCADE'
  });

  AutoScheduleSubmission.belongsTo(models.User, {
    foreignKey: 'decidedBy',
    as: 'decider',
    onDelete: 'SET NULL',
    onUpdate: 'CASCADE'
  });
};

module.exports = AutoScheduleSubmission;
