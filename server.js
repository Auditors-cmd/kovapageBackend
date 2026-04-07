const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const qaRoutes = require('./routes/qualityAssurance');
const unitHeadRoutes = require('./routes/unitHead');
const caeRoutes = require('./routes/cae');
const auditRoutes = require('./routes/audit');
const auditeeRoutes = require('./routes/auditee');
const fs = require('fs');
const path = require('path');
const dotenv = require('dotenv');

const envCandidates = [
  path.resolve(process.cwd(), '.env'),
  path.resolve(__dirname, '.env'),
  path.resolve(__dirname, '../.env')
];

const envPath = envCandidates.find((candidate) => fs.existsSync(candidate));
dotenv.config(envPath ? { path: envPath } : undefined);

console.log('DATABASE_URL exists:', !!process.env.DATABASE_URL);
console.log('NODE_ENV:', process.env.NODE_ENV);


// DATABASE CONNECTION

const { sequelize, testConnection } = require('./config/database');


// IMPORT ALL MODELS

const User = require('./models/User');
const OTP = require('./models/OTP');
const RiskAssessment = require('./models/RiskAssessment');
const AuditPlan = require('./models/AuditPlan');
const MonitoringDashboard = require('./models/MonitoringDashboard');
const AuditPlanTeamMember = require('./models/AuditPlanTeamMember');
const DashboardShare = require('./models/DashboardShare');
const AuditAssignmentTask = require('./models/AuditAssignmentTask');
const Notification = require('./models/Notification');
const AutoScheduleSubmission = require('./models/AutoScheduleSubmission');
const DocumentRequest = require('./models/DocumentRequest');
const GovernanceDocument = require('./models/GovernanceDocument');
const DocumentComment = require('./models/DocumentComment');


// SET UP ASSOCIATIONS - IMPROVED VERSION

const setupAssociations = () => {
  console.log('Setting up model associations...');
  
  // Create a models object with all models
  const models = {
    User,
    OTP,
    RiskAssessment,
    AuditPlan,
    MonitoringDashboard,
    AuditPlanTeamMember,
    DashboardShare,
    AuditAssignmentTask,
    Notification,
    AutoScheduleSubmission,
    DocumentRequest,
    GovernanceDocument,
    DocumentComment
  };

  // Initialize associations for each model that has an associate method
  const modelsWithAssociations = [
    User, 
    OTP, 
    RiskAssessment, 
    AuditPlan, 
    MonitoringDashboard, 
    AuditPlanTeamMember, 
    DashboardShare,
    AuditAssignmentTask,
    Notification,
    AutoScheduleSubmission,
    DocumentRequest,
    GovernanceDocument,
    DocumentComment
  ];

  modelsWithAssociations.forEach(model => {
    if (model.associate) {
      model.associate(models);
      console.log(`${model.name} associations loaded`);
    }
  });

  // Specifically log AuditPlan associations to verify
  if (AuditPlan.associate) {
    console.log('AuditPlan associations verified');
  } else {
    console.log('WARNING: AuditPlan.associate method not found!');
  }

  console.log('All model associations initialized');
};

// Run associations setup
setupAssociations();

const authRoutes = require('./routes/auth');
const { swaggerUi, swaggerDocument, swaggerOptions } = require('./swagger');

const app = express();
const PORT = process.env.PORT || 5000;

const resolveTrustProxy = () => {
  const value = String(process.env.TRUST_PROXY || '1').trim().toLowerCase();

  if (value === 'true') return true;
  if (value === 'false') return false;
  if (/^\d+$/.test(value)) return Number(value);
  return value;
};

app.set('trust proxy', resolveTrustProxy());


// DATABASE INITIALIZATION

const initializeDatabase = async () => {
  try {
    // Test connection
    await testConnection();
    
    // Sync all models with associations
    await sequelize.sync({ alter: true });
    console.log('PostgreSQL tables synced successfully');
    
    // Log which tables were created/updated
    const tables = await sequelize.getQueryInterface().showAllTables();
    console.log('Available tables:', tables.join(', '));
    
  } catch (error) {
    console.error('Database initialization error:', error);
    process.exit(1);
  }
};



// MIDDLEWARE

app.use(helmet());

// Serve static files from uploads directory
app.use('/uploads', express.static('uploads'));

// CORS CONFIGURATION (ALLOWS ALL ORIGINS)
app.use(cors({
  origin: '*',
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With']
}));

// Additional CORS headers
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Requested-With');
  
  if (req.method === 'OPTIONS') {
    return res.sendStatus(200);
  }
  next();
});

app.use(express.json());

// Rate limiting
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: {
    success: false,
    message: 'Too many authentication attempts, please try again later.'
  }
});
app.use('/api/auth/', authLimiter);


// ROUTES

app.use('/api/qa', qaRoutes);
app.use('/api/unit-head', unitHeadRoutes);
app.use('/api/cae', caeRoutes);
app.use('/api/audit', auditRoutes);
app.use('/api/auditee', auditeeRoutes);
app.use('/api/auth', authRoutes);

// SWAGGER DOCUMENTATION
app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerDocument, swaggerOptions));

// REQUEST LOGGING
app.use((req, res, next) => {
  console.log('REQUEST', req.method, req.url, {
    ip: req.ip,
    timestamp: new Date().toISOString()
  });
  next();
});


// ROOT ROUTE

app.get('/', (req, res) => {
  res.json({
    success: true,
    message: 'Welcome to KovaPage Audit API',
    version: '1.0.0',
    documentation: '/api-docs',
    health: '/api/health',
    database: 'PostgreSQL',
    endpoints: [
      'GET  /api/health',
      'POST /api/auth/login', 
      'POST /api/auth/email/login',
      'POST /api/auth/email/verify-login',
      'POST /api/auth/forgot-password',
      'POST /api/auth/reset-password',
      'GET  /api/auth/profile',
      'GET  /api/auth/status',
      'GET  /api/test',
      'GET  /api/qa/audit-plans',
      'GET  /api/qa/risk-assessments',
      'GET  /api/qa/dashboard',
      'GET  /api/qa/dashboard-data',
      'GET  /api/unit-head/dashboard-data',
      'GET  /api/unit-head/approved-plan-data',
      'POST /api/unit-head/approved-plan/:id/assign',
      'GET  /api/unit-head/auto-schedule/recommendations',
      'GET  /api/qa/auto-schedule/recommendations',
      'GET  /api/qa/auto-schedule/submissions',
      'POST /api/qa/auto-schedule/submit-to-cae',
      'GET  /api/cae/auto-schedule/submissions',
      'GET  /api/cae/auto-schedule/submissions/:submissionId',
      'POST /api/cae/auto-schedule/:submissionId/approve',
      'POST /api/cae/auto-schedule/:submissionId/reject',
      'GET  /api/unit-head/draft-plan-review-data',
      'GET  /api/unit-head/risk-assessments',
      'PUT  /api/unit-head/risk-assessments/:id/finalization',
      'POST /api/unit-head/risk-assessments/save-draft',
      'POST /api/unit-head/risk-assessments/submit-to-qa',
      'GET  /api/unit-head/apm',
      'POST /api/unit-head/apm',
      'GET  /api/unit-head/apm/:id',
      'PUT  /api/unit-head/apm/:id',
      'POST /api/unit-head/apm/:id/submit',
      'POST /api/unit-head/apm/:id/approve',
      'POST /api/unit-head/apm/:id/reject',
      'POST /api/qa/upload-risk-data',
      'POST /api/qa/upload-risk-excel',
      'GET  /api/qa/download-risk-template',
      'PUT  /api/qa/audit-plans/:id/score',
      'GET  /api/qa/audit-plans/export-excel',
      'GET  /api/qa/audit-plans/export-pdf',
      'POST /api/qa/submit-to-cae',
      'POST /api/qa/consolidate-plans',
      'GET  /api/audit/document-requests',
      'POST /api/audit/document-requests',
      'GET  /api/audit/governance-documents',
      'GET  /api/auditee/document-requests',
      'GET  /api/auditee/governance-documents'
    ],
    timestamp: new Date().toISOString()
  });
});

// Health check
app.get('/api/health', async (req, res) => {
  try {
    await sequelize.authenticate();
    res.json({ 
      status: 'OK',
      message: 'KovaPage API with PostgreSQL is running!',
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
      environment: process.env.NODE_ENV || 'development',
      database: 'PostgreSQL - Connected'
    });
  } catch (error) {
    res.status(503).json({ 
      status: 'ERROR',
      message: 'Database connection failed',
      timestamp: new Date().toISOString(),
      database: 'PostgreSQL - Disconnected'
    });
  }
});

// Test endpoint
app.get('/api/test', (req, res) => {
  res.json({
    success: true,
    message: 'Test endpoint working!',
    timestamp: new Date().toISOString()
  });
});

// 404 handler
app.use((req, res) => {
  console.log('Route not found:', req.originalUrl);
  res.status(404).json({
    success: false,
    message: 'Route not found: ' + req.originalUrl
  });
});

// Error handler
app.use((error, req, res, next) => {
  console.error('Server error:', error);
  
  // Send more detailed error in development
  if (process.env.NODE_ENV === 'development') {
    res.status(500).json({
      success: false,
      message: error.message,
      stack: error.stack
    });
  } else {
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
});

// Graceful shutdown
process.on('SIGINT', async () => {
  console.log(' Shutting down gracefully...');
  await sequelize.close();
  process.exit(0);
});

const startServer = async () => {
  await initializeDatabase();

  app.listen(PORT, () => {
    console.log('========================================');
    console.log('KOVAPAGE BACKEND SERVER');
    console.log('========================================');
    console.log(`Server running on port ${PORT}`);
    console.log(`Local: http://localhost:${PORT}/`);
    console.log(`Health: http://localhost:${PORT}/api/health`);
    console.log(`Docs: http://localhost:${PORT}/api-docs`);
    console.log('Database: PostgreSQL');
    console.log('CORS: Enabled for all origins');
    console.log('Models loaded: User, OTP, RiskAssessment, AuditPlan, MonitoringDashboard, AuditPlanTeamMember, DashboardShare, AuditAssignmentTask, Notification, AutoScheduleSubmission, DocumentRequest, GovernanceDocument, DocumentComment');
    console.log('========================================');
  });
};

startServer().catch((error) => {
  console.error('Failed to start server:', error);
  process.exit(1);
});
