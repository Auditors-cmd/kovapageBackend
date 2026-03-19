const { Sequelize } = require('sequelize');
const fs = require('fs');
const path = require('path');
const dotenv = require('dotenv');

const envCandidates = [
  path.resolve(process.cwd(), '.env'),
  path.resolve(__dirname, '../.env'),
  path.resolve(__dirname, '../../.env')
];

const envPath = envCandidates.find((candidate) => fs.existsSync(candidate));
dotenv.config(envPath ? { path: envPath } : undefined);

let sequelize;

// Check if we should use a DATABASE_URL (common in production like Render)
if (process.env.DATABASE_URL) {
  let connectionUrl = process.env.DATABASE_URL;

  try {
    const parsedUrl = new URL(process.env.DATABASE_URL);
    const sslMode = parsedUrl.searchParams.get('sslmode');

    // Managed providers (Render/Supabase poolers) often require no-verify unless a CA bundle is configured.
    if (!sslMode || sslMode === 'require') {
      parsedUrl.searchParams.set('sslmode', process.env.DB_SSL_MODE || 'no-verify');
    }

    connectionUrl = parsedUrl.toString();
  } catch (error) {
    console.warn('⚠️ DATABASE_URL could not be parsed, using original value.');
  }

  // Use the DATABASE_URL for connection
  sequelize = new Sequelize(connectionUrl, {
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
