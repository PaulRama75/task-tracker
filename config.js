require('dotenv').config();

function loadConfig() {
  const isProduction = process.env.NODE_ENV === 'production';

  // In production, require critical DB environment variables
  const requiredInProd = ['DB_HOST', 'DB_NAME', 'DB_USER', 'DB_PASS'];
  if (isProduction) {
    const missing = requiredInProd.filter(k => !process.env[k]);
    if (missing.length > 0) {
      throw new Error(`Missing required environment variables: ${missing.join(', ')}`);
    }
  }

  return {
    port: parseInt(process.env.PORT, 10) || 3002,
    db: {
      host: process.env.DB_HOST || 'localhost',
      port: parseInt(process.env.DB_PORT, 10) || 5432,
      database: process.env.DB_NAME || 'task_tracker',
      user: process.env.DB_USER || 'postgres',
      password: process.env.DB_PASS || 'postgres',
      max: 10,
    },
    trackerDir: process.env.TRACKER_DIR || null,
    sessionTimeout: parseInt(process.env.SESSION_TIMEOUT, 10) || 30 * 60 * 1000,
    maxLoginAttempts: parseInt(process.env.MAX_LOGIN_ATTEMPTS, 10) || 5,
    lockoutDuration: parseInt(process.env.LOCKOUT_DURATION, 10) || 15 * 60 * 1000,
    corsOrigin: process.env.CORS_ORIGIN || false,
    maxFileSize: parseInt(process.env.MAX_FILE_SIZE, 10) || 10 * 1024 * 1024,
  };
}

const config = loadConfig();

module.exports = config;
