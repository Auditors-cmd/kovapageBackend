const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
require('dotenv').config();

const { sequelize, testConnection } = require('./config/database');
const authRoutes = require('./routes/auth');
const { swaggerUi, swaggerDocument, swaggerOptions } = require('./swagger');

const app = express();
const PORT = process.env.PORT || 5000;

// =======================
// DATABASE INITIALIZATION
// =======================
const initializeDatabase = async () => {
  try {
    // Test connection
    await testConnection();
    
    // Sync models (create tables if they don't exist)
    await sequelize.sync({ force: false }); // we shall use { force: true } only in development to drop tables
    console.log('✅ PostgreSQL tables synced successfully');
  } catch (error) {
    console.error('❌ Database initialization error:', error);
    process.exit(1);
  }
};

// Initialize database
initializeDatabase();

// =======================
// SECURITY MIDDLEWARE
// =======================
app.use(helmet());
app.use(cors());
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

// =======================
// SWAGGER DOCUMENTATION
// =======================
app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerDocument, swaggerOptions));

// =======================
// REQUEST LOGGING
// =======================
app.use((req, res, next) => {
  console.log('📨', req.method, req.url, {
    ip: req.ip,
    timestamp: new Date().toISOString()
  });
  next();
});

// =======================
// ROOT ROUTE
// =======================
app.get('/', (req, res) => {
  res.json({
    success: true,
    message: '🚀 Welcome to KovaPage Audit API',
    version: '1.0.0',
    documentation: '/api-docs',
    health: '/api/health',
    database: 'PostgreSQL',
    endpoints: [
      'GET  /api/health',
      'POST /api/auth/register',
      'POST /api/auth/login', 
      'POST /api/auth/email/register',
      'POST /api/auth/email/verify',
      'POST /api/auth/email/login',
      'POST /api/auth/email/verify-login',
      'POST /api/auth/forgot-password',
      'POST /api/auth/reset-password',
      'GET  /api/auth/profile',
      'GET  /api/auth/status',
      'GET  /api/test'
    ],
    timestamp: new Date().toISOString()
  });
});

// =======================
// API ROUTES
// =======================
app.use('/api/auth', authRoutes);

// =======================
// CLEAN ROUTES
// =======================

// Health check
app.get('/api/health', async (req, res) => {
  try {
    // Test database connection
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
  console.log('❌ Route not found:', req.originalUrl);
  res.status(404).json({
    success: false,
    message: 'Route not found: ' + req.originalUrl
  });
});

// Error handler
app.use((error, req, res, next) => {
  console.error(' Server error:', error);
  res.status(500).json({
    success: false,
    message: 'Internal server error'
  });
});

// Graceful shutdown
process.on('SIGINT', async () => {
  console.log(' Shutting down gracefully...');
  await sequelize.close();
  process.exit(0);
});

// Start server
app.listen(PORT, () => {
  console.log('========================================');
  console.log('KOVAPAGE WITH POSTGRESQL');
  console.log('========================================');
  console.log(`Server running on port ${PORT}`);
  console.log(` API Root: http://localhost:${PORT}/`);
  console.log(` Health Check: http://localhost:${PORT}/api/health`);
  console.log(`Swagger Docs: http://localhost:${PORT}/api-docs`);
  console.log(' Database: PostgreSQL');
  console.log('========================================');
});