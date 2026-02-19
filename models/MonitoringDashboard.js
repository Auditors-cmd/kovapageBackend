const { DataTypes } = require('sequelize');
const { sequelize } = require('../config/database');

const MonitoringDashboard = sequelize.define('MonitoringDashboard', {
  id: {
    type: DataTypes.UUID,
    defaultValue: DataTypes.UUIDV4,
    primaryKey: true
  },
  // Dashboard configuration
  name: {
    type: DataTypes.STRING,
    allowNull: false
  },
  dashboardType: {
    type: DataTypes.ENUM('qa', 'unit', 'executive', 'custom'),
    defaultValue: 'qa'
  },
  // Metrics snapshot
  metrics: {
    type: DataTypes.JSONB,
    defaultValue: {},
    comment: 'Stores dashboard metrics like counts, percentages, trends'
  },
  // Risk assessment summary
  riskSummary: {
    type: DataTypes.JSONB,
    defaultValue: {
      total: 0,
      pending: 0,
      inProgress: 0,
      completed: 0,
      highRisk: 0,
      mediumRisk: 0,
      lowRisk: 0
    }
  },
  // Audit plan summary
  planSummary: {
    type: DataTypes.JSONB,
    defaultValue: {
      total: 0,
      draft: 0,
      underReview: 0,
      approved: 0,
      consolidated: 0
    }
  },
  // Recent activities
  recentActivities: {
    type: DataTypes.JSONB,
    defaultValue: []
  },
  // Charts data
  chartsData: {
    type: DataTypes.JSONB,
    defaultValue: {
      riskTrend: [],
      statusDistribution: [],
      completionTimeline: []
    }
  },
  // Date range for this dashboard view
  dateFrom: {
    type: DataTypes.DATE,
    allowNull: true
  },
  dateTo: {
    type: DataTypes.DATE,
    allowNull: true
  },
  // Ownership
  createdBy: {
    type: DataTypes.UUID,
    allowNull: false,
    references: {
      model: 'users',
      key: 'id'
    }
  },
  // Sharing
  sharedWith: {
    type: DataTypes.ARRAY(DataTypes.UUID),
    defaultValue: []
  },
  isPublic: {
    type: DataTypes.BOOLEAN,
    defaultValue: false
  }
}, {
  tableName: 'monitoring_dashboards',
  indexes: [
    {
      fields: ['createdBy']
    },
    {
      fields: ['dashboardType']
    }
  ]
});

module.exports = MonitoringDashboard;