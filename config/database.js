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

const parseBoolean = (value, fallback = false) => {
  if (value === undefined || value === null || value === '') return fallback;
  return String(value).trim().toLowerCase() === 'true';
};

const shouldUseSsl = process.env.DB_SSL !== undefined
  ? parseBoolean(process.env.DB_SSL, false)
  : Boolean(process.env.DATABASE_URL);

const rejectUnauthorized = parseBoolean(process.env.DB_SSL_REJECT_UNAUTHORIZED, false);

const buildSslConfig = () => {
  if (!shouldUseSsl) return undefined;

  const ssl = {
    require: true,
    rejectUnauthorized
  };

  if (process.env.DB_SSL_CA) {
    ssl.ca = String(process.env.DB_SSL_CA).replace(/\\n/g, '\n');
  }

  return ssl;
};

const sslConfig = buildSslConfig();

const baseSequelizeConfig = {
  dialect: 'postgres',
  logging: process.env.NODE_ENV === 'development' ? console.log : false,
  dialectOptions: {
    ...(sslConfig ? { ssl: sslConfig } : {}),
    ...(process.env.DB_SSL_MODE ? { sslmode: process.env.DB_SSL_MODE } : {})
  },
  pool: {
    max: 5,
    min: 0,
    acquire: 30000,
    idle: 10000
  }
};

let sequelize;

if (process.env.DATABASE_URL) {
  let connectionUrl = process.env.DATABASE_URL;

  try {
    const parsedUrl = new URL(process.env.DATABASE_URL);

    // Remove SSL params from URL so Sequelize/pg dialectOptions controls SSL consistently.
    parsedUrl.searchParams.delete('sslmode');
    parsedUrl.searchParams.delete('sslcert');
    parsedUrl.searchParams.delete('sslkey');
    parsedUrl.searchParams.delete('sslrootcert');

    connectionUrl = parsedUrl.toString();
  } catch (error) {
    console.warn('DATABASE_URL could not be parsed, using original value.');
  }

  sequelize = new Sequelize(connectionUrl, baseSequelizeConfig);
  console.log('Configuring Sequelize using DATABASE_URL');
} else {
  sequelize = new Sequelize(
    process.env.DB_NAME || 'kovapage',
    process.env.DB_USER || 'postgres',
    process.env.DB_PASSWORD || 'password',
    {
      host: process.env.DB_HOST || 'localhost',
      port: Number(process.env.DB_PORT || 5432),
      ...baseSequelizeConfig
    }
  );
  console.log('Configuring Sequelize using individual DB_* variables');
}

if (shouldUseSsl) {
  console.log('PostgreSQL SSL enabled:', {
    rejectUnauthorized,
    hasCustomCa: Boolean(process.env.DB_SSL_CA)
  });
}

const testConnection = async () => {
  try {
    await sequelize.authenticate();
    console.log('PostgreSQL connected successfully');
  } catch (error) {
    console.error('Unable to connect to PostgreSQL:', error);
    throw error;
  }
};

module.exports = { sequelize, testConnection };
