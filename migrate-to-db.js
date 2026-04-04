#!/usr/bin/env node
/**
 * Migration script: JSON files → PostgreSQL
 *
 * Usage: node migrate-to-db.js
 *
 * This will read all data from data/*.json files and import into PostgreSQL.
 * Set environment variables for DB connection:
 *   DB_HOST (default: localhost)
 *   DB_PORT (default: 5432)
 *   DB_NAME (default: task_tracker)
 *   DB_USER (default: postgres)
 *   DB_PASS (default: postgres)
 */

const path = require('path');
const db = require('./db');

const DATA_DIR = path.join(__dirname, 'data');

async function main() {
  console.log('=== Task Tracker: JSON → PostgreSQL Migration ===\n');

  try {
    // 1. Initialize schema
    console.log('1. Creating database schema...');
    await db.initDB();
    console.log('   Done.\n');

    // 2. Migrate data
    console.log('2. Migrating data from JSON files...');
    await db.migrateFromJSON(DATA_DIR);
    console.log('   Done.\n');

    console.log('=== Migration complete! ===');
    console.log('\nYou can now start the server with: node server.js');
    console.log('The server will use PostgreSQL instead of JSON files.');
  } catch (e) {
    console.error('\nMigration failed:', e.message);
    console.error(e.stack);
    process.exit(1);
  } finally {
    await db.pool.end();
  }
}

main();
