const path = require('path');
const fs = require('fs');
const dotenv = require('dotenv');

const envCandidates = [
  path.resolve(process.cwd(), '.env'),
  path.resolve(__dirname, '../.env'),
  path.resolve(__dirname, '../../.env')
];

const envPath = envCandidates.find((candidate) => fs.existsSync(candidate));
dotenv.config(envPath ? { path: envPath } : undefined);

const { sequelize, testConnection } = require('../config/database');
const User = require('../models/User');
const OTP = require('../models/OTP');
const RiskAssessment = require('../models/RiskAssessment');
const AuditPlan = require('../models/AuditPlan');
const MonitoringDashboard = require('../models/MonitoringDashboard');
const AuditPlanTeamMember = require('../models/AuditPlanTeamMember');
const DashboardShare = require('../models/DashboardShare');

const models = {
  User,
  OTP,
  RiskAssessment,
  AuditPlan,
  MonitoringDashboard,
  AuditPlanTeamMember,
  DashboardShare
};

function setupAssociations() {
  const modelsWithAssociations = [
    User,
    OTP,
    RiskAssessment,
    AuditPlan,
    MonitoringDashboard,
    AuditPlanTeamMember,
    DashboardShare
  ];

  for (const model of modelsWithAssociations) {
    if (typeof model.associate === 'function') {
      model.associate(models);
    }
  }
}

async function setupDatabase() {
  try {
    console.log('Starting Supabase database setup...');
    await testConnection();

    setupAssociations();

    await sequelize.sync({ alter: true });
    console.log('Database schema synced successfully.');

    const tables = await sequelize.getQueryInterface().showAllTables();
    console.log('Available tables:', tables.join(', '));
  } catch (error) {
    console.error('Database setup failed:', error);
    process.exitCode = 1;
  } finally {
    await sequelize.close();
  }
}

setupDatabase();
