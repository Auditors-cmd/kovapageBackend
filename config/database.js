const { Sequelize } = require('sequelize');
require('dotenv').config();

let sequelize;

// Check if we should use a DATABASE_URL (common in production like Render)
if (process.env.DATABASE_URL) {
  // Use the DATABASE_URL for connection
  sequelize = new Sequelize(process.env.DATABASE_URL, {
    dialect: 'postgres',
    logging: process.env.NODE_ENV === 'development' ? console.log : false,
    dialectOptions: {
      ssl: {
        require: true,
        rejectUnauthorized: false // <<< This is crucial for Render's PostgreSQL
      }
    },
    pool: {
      max: 5,
      min: 0,
      acquire: 30000,
      idle: 10000
    }
  });
  console.log('🔌 Configuring Sequelize using DATABASE_URL with SSL');
} else {
  // Fallback to individual environment variables for local development
  sequelize = new Sequelize(
    process.env.DB_NAME || 'kovapage',
    process.env.DB_USER || 'postgres',
    process.env.DB_PASSWORD || 'password',
    {
      host: process.env.DB_HOST || 'localhost',
      port: process.env.DB_PORT || 5432,
      dialect: 'postgres',
      logging: process.env.NODE_ENV === 'development' ? console.log : false,
      pool: {
        max: 5,
        min: 0,
        acquire: 30000,
        idle: 10000
      }
    }
  );
  console.log('🔌 Configuring Sequelize using individual DB_* variables');
}

// Test connection
const testConnection = async () => {
  try {
    await sequelize.authenticate();
    console.log('✅ PostgreSQL connected successfully');
  } catch (error) {
    console.error('❌ Unable to connect to PostgreSQL:', error);
  }
};

module.exports = { sequelize, testConnection };