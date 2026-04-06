#!/usr/bin/env node
/**
 * Migration script: JSON files → PostgreSQL
 *
 * Usage:
 *   node migrate-to-db.js                  — Run migration with backup + transaction
 *   node migrate-to-db.js --restore <file> — Restore DB state from a backup JSON file
 *
 * This will read all data from data/*.json files and import into PostgreSQL.
 * Before migrating, a backup snapshot of the current DB state is saved to
 * data/backup-pre-migration-{timestamp}.json.
 *
 * Set environment variables for DB connection:
 *   DB_HOST (default: localhost)
 *   DB_PORT (default: 5432)
 *   DB_NAME (default: task_tracker)
 *   DB_USER (default: postgres)
 *   DB_PASS (default: postgres)
 */

const fs = require('fs');
const path = require('path');
const db = require('./db');

const DATA_DIR = path.join(__dirname, 'data');

// ========== SNAPSHOT / BACKUP ==========

/**
 * Capture a JSON snapshot of the current DB state (users, sites, site states).
 */
async function captureDBSnapshot(client) {
  // Users
  const usersRes = await client.query(
    'SELECT username, password_hash, salt, role, allowed_sites, allowed_apps FROM users ORDER BY id'
  );
  const users = usersRes.rows.map(r => ({
    username: r.username,
    passwordHash: r.password_hash,
    salt: r.salt,
    role: r.role,
    allowedSites: r.allowed_sites || [],
    allowedApps: (r.allowed_apps || []).map(Number)
  }));

  // Sites
  const sitesRes = await client.query('SELECT id, name, app_id FROM sites ORDER BY created_at');
  const sites = sitesRes.rows.map(r => ({ id: r.id, name: r.name, appId: r.app_id }));

  // Site states (full state per site)
  const siteStates = {};
  for (const site of sites) {
    siteStates[site.id] = await loadSiteStateWithClient(client, site.id);
  }

  return { users, sites, siteStates, capturedAt: new Date().toISOString() };
}

/**
 * Load full site state using a provided client (no pool.connect).
 * Mirrors db.loadSiteState but uses the given client for transaction safety.
 */
async function loadSiteStateWithClient(client, siteId) {
  const metaRes = await client.query('SELECT * FROM site_meta WHERE site_id=$1', [siteId]);
  const meta = metaRes.rows[0] || { active_section: 'PIPE', page: 0, page_size: 100 };

  const initRes = await client.query('SELECT initial, name FROM initials WHERE site_id=$1 ORDER BY id', [siteId]);

  const secRes = await client.query('SELECT id, name, label, original_headers FROM sections WHERE site_id=$1 ORDER BY id', [siteId]);
  const sections = {};

  for (const sec of secRes.rows) {
    const wRes = await client.query('SELECT task, tracker_col, weight, minutes FROM weights WHERE section_id=$1 ORDER BY id', [sec.id]);
    const icRes = await client.query('SELECT name, col_index FROM info_cols WHERE section_id=$1 ORDER BY col_index', [sec.id]);
    const tcRes = await client.query('SELECT task, date_col, init_col, date_header, init_header FROM task_cols WHERE section_id=$1 ORDER BY id', [sec.id]);
    const rowRes = await client.query('SELECT id, row_index, info_data FROM tracker_rows WHERE section_id=$1 ORDER BY row_index', [sec.id]);

    const rows = [];
    for (const row of rowRes.rows) {
      const teRes = await client.query('SELECT task_name, date_val, initial FROM task_entries WHERE row_id=$1', [row.id]);
      const tasks = {};
      teRes.rows.forEach(te => { tasks[te.task_name] = { date: te.date_val || '', initial: te.initial || '' }; });
      rows.push({ _info: row.info_data || {}, _tasks: tasks });
    }

    sections[sec.name] = {
      label: sec.label,
      weights: wRes.rows.map(w => ({ task: w.task, trackerCol: w.tracker_col, weight: parseFloat(w.weight), minutes: parseFloat(w.minutes) })),
      infoCols: icRes.rows.map(c => ({ name: c.name, index: c.col_index })),
      taskCols: tcRes.rows.map(t => ({ task: t.task, dateCol: t.date_col, initCol: t.init_col, dateHeader: t.date_header, initHeader: t.init_header })),
      rows,
      originalHeaders: sec.original_headers || []
    };
  }

  const billRes = await client.query('SELECT po_amount, rate FROM billing WHERE site_id=$1', [siteId]);
  const bill = billRes.rows[0] || { po_amount: 0, rate: 0 };
  const tsRes = await client.query('SELECT week, st, ot, total_hrs, equip, total_cost, notes FROM billing_timesheet WHERE site_id=$1 ORDER BY row_index', [siteId]);

  return {
    initials: initRes.rows.map(r => ({ initial: r.initial, name: r.name })),
    sections,
    activeSection: meta.active_section,
    billing: {
      po: parseFloat(bill.po_amount),
      rate: parseFloat(bill.rate),
      timesheet: tsRes.rows.map(t => ({
        week: t.week, st: parseFloat(t.st), ot: parseFloat(t.ot),
        totalHrs: parseFloat(t.total_hrs), equip: parseFloat(t.equip),
        totalCost: parseFloat(t.total_cost), notes: t.notes
      }))
    },
    page: meta.page,
    pageSize: meta.page_size
  };
}

/**
 * Save full site state using a provided client (no pool.connect, no inner transaction).
 * Mirrors db.saveSiteState but uses the given client for transaction safety.
 */
async function saveSiteStateWithClient(client, siteId, state) {
  // Upsert meta
  await client.query(`
    INSERT INTO site_meta (site_id, active_section, page, page_size) VALUES ($1,$2,$3,$4)
    ON CONFLICT (site_id) DO UPDATE SET active_section=$2, page=$3, page_size=$4
  `, [siteId, state.activeSection || 'PIPE', state.page || 0, state.pageSize || 100]);

  // Upsert initials
  await client.query('DELETE FROM initials WHERE site_id=$1', [siteId]);
  for (const ini of (state.initials || [])) {
    await client.query(
      'INSERT INTO initials (site_id, initial, name) VALUES ($1,$2,$3) ON CONFLICT (site_id, initial) DO UPDATE SET name=$3',
      [siteId, ini.initial, ini.name]
    );
  }

  // Get existing sections
  const existingSecRes = await client.query('SELECT id, name FROM sections WHERE site_id=$1', [siteId]);
  const existingSecs = {};
  existingSecRes.rows.forEach(r => { existingSecs[r.name] = r.id; });

  const stateSections = state.sections || {};
  const processedNames = new Set();

  for (const [secName, secData] of Object.entries(stateSections)) {
    processedNames.add(secName);
    let sectionId;

    if (existingSecs[secName]) {
      sectionId = existingSecs[secName];
      await client.query('UPDATE sections SET label=$1, original_headers=$2 WHERE id=$3',
        [secData.label || secName, JSON.stringify(secData.originalHeaders || []), sectionId]);
    } else {
      const insRes = await client.query(
        'INSERT INTO sections (site_id, name, label, original_headers) VALUES ($1,$2,$3,$4) RETURNING id',
        [siteId, secName, secData.label || secName, JSON.stringify(secData.originalHeaders || [])]
      );
      sectionId = insRes.rows[0].id;
    }

    // Weights
    await client.query('DELETE FROM weights WHERE section_id=$1', [sectionId]);
    for (const w of (secData.weights || [])) {
      await client.query('INSERT INTO weights (section_id, task, tracker_col, weight, minutes) VALUES ($1,$2,$3,$4,$5)',
        [sectionId, w.task, w.trackerCol, w.weight || 0, w.minutes || 0]);
    }

    // Info cols
    await client.query('DELETE FROM info_cols WHERE section_id=$1', [sectionId]);
    for (let i = 0; i < (secData.infoCols || []).length; i++) {
      const c = secData.infoCols[i];
      await client.query('INSERT INTO info_cols (section_id, name, col_index) VALUES ($1,$2,$3)',
        [sectionId, c.name, c.index !== undefined ? c.index : i]);
    }

    // Task cols
    await client.query('DELETE FROM task_cols WHERE section_id=$1', [sectionId]);
    for (const tc of (secData.taskCols || [])) {
      await client.query('INSERT INTO task_cols (section_id, task, date_col, init_col, date_header, init_header) VALUES ($1,$2,$3,$4,$5,$6)',
        [sectionId, tc.task, tc.dateCol, tc.initCol, tc.dateHeader, tc.initHeader]);
    }

    // Rows + task entries
    await client.query('DELETE FROM tracker_rows WHERE section_id=$1', [sectionId]);
    for (let ri = 0; ri < (secData.rows || []).length; ri++) {
      const row = secData.rows[ri];
      const rowRes = await client.query(
        'INSERT INTO tracker_rows (section_id, row_index, info_data) VALUES ($1,$2,$3) RETURNING id',
        [sectionId, ri, JSON.stringify(row._info || {})]
      );
      const rowId = rowRes.rows[0].id;
      for (const [taskName, taskData] of Object.entries(row._tasks || {})) {
        await client.query(
          'INSERT INTO task_entries (row_id, task_name, date_val, initial) VALUES ($1,$2,$3,$4)',
          [rowId, taskName, taskData.date || '', taskData.initial || '']
        );
      }
    }
  }

  // Delete sections that no longer exist
  for (const [name, id] of Object.entries(existingSecs)) {
    if (!processedNames.has(name)) {
      await client.query('DELETE FROM sections WHERE id=$1', [id]);
    }
  }

  // Billing
  const billing = state.billing || {};
  await client.query(`
    INSERT INTO billing (site_id, po_amount, rate) VALUES ($1,$2,$3)
    ON CONFLICT (site_id) DO UPDATE SET po_amount=$2, rate=$3
  `, [siteId, billing.po || 0, billing.rate || 0]);

  await client.query('DELETE FROM billing_timesheet WHERE site_id=$1', [siteId]);
  for (let i = 0; i < (billing.timesheet || []).length; i++) {
    const t = billing.timesheet[i];
    await client.query(
      'INSERT INTO billing_timesheet (site_id, week, st, ot, total_hrs, equip, total_cost, notes, row_index) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)',
      [siteId, t.week || '', t.st || 0, t.ot || 0, t.totalHrs || 0, t.equip || 0, t.totalCost || 0, t.notes || '', i]
    );
  }
}

// ========== MIGRATION (transactional) ==========

/**
 * Run migration from JSON files within a single DB transaction.
 * Uses the provided client so everything is atomic.
 */
async function migrateFromJSONTransactional(client, dataDir) {
  // Migrate users
  const usersFile = path.join(dataDir, 'users.json');
  if (fs.existsSync(usersFile)) {
    const users = JSON.parse(fs.readFileSync(usersFile, 'utf8'));
    for (const u of users) {
      try {
        await client.query(
          'INSERT INTO users (username, password_hash, salt, role, allowed_sites, allowed_apps) VALUES ($1,$2,$3,$4,$5,$6)',
          [u.username, u.passwordHash, u.salt, u.role || 'user', u.allowedSites || [], u.allowedApps || []]
        );
        console.log(`  Migrated user: ${u.username} (${u.role || 'user'})`);
      } catch (e) {
        if (e.code === '23505') console.log(`  User ${u.username} already exists, skipping`);
        else throw e;
      }
    }
  }

  // Migrate sites + site states
  const sitesFile = path.join(dataDir, 'sites.json');
  if (fs.existsSync(sitesFile)) {
    const sites = JSON.parse(fs.readFileSync(sitesFile, 'utf8'));
    for (const site of sites) {
      try {
        await client.query('INSERT INTO sites (id, name) VALUES ($1,$2)', [site.id, site.name]);
        await client.query('INSERT INTO site_meta (site_id) VALUES ($1) ON CONFLICT DO NOTHING', [site.id]);
        await client.query('INSERT INTO billing (site_id) VALUES ($1) ON CONFLICT DO NOTHING', [site.id]);
        console.log(`  Migrated site: ${site.name} (${site.id})`);
      } catch (e) {
        if (e.code === '23505') console.log(`  Site ${site.name} already exists, skipping`);
        else throw e;
      }

      // Migrate site state
      const stateFile = path.join(dataDir, `state-${site.id}.json`);
      if (fs.existsSync(stateFile)) {
        const state = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
        await saveSiteStateWithClient(client, site.id, state);
        console.log(`  Migrated state for site: ${site.name}`);
      }
    }
  }
}

// ========== RESTORE ==========

/**
 * Restore DB state from a backup JSON file.
 */
async function restoreFromBackup(backupFilePath) {
  if (!fs.existsSync(backupFilePath)) {
    throw new Error(`Backup file not found: ${backupFilePath}`);
  }

  const snapshot = JSON.parse(fs.readFileSync(backupFilePath, 'utf8'));
  console.log(`Restoring from backup: ${backupFilePath}`);
  console.log(`Backup captured at: ${snapshot.capturedAt}`);

  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');

    // Clear existing data in reverse dependency order
    await client.query('DELETE FROM task_entries');
    await client.query('DELETE FROM tracker_rows');
    await client.query('DELETE FROM weights');
    await client.query('DELETE FROM info_cols');
    await client.query('DELETE FROM task_cols');
    await client.query('DELETE FROM billing_timesheet');
    await client.query('DELETE FROM billing');
    await client.query('DELETE FROM initials');
    await client.query('DELETE FROM sections');
    await client.query('DELETE FROM site_meta');
    await client.query('DELETE FROM sites');
    await client.query('DELETE FROM users');

    // Restore users
    for (const u of (snapshot.users || [])) {
      await client.query(
        'INSERT INTO users (username, password_hash, salt, role, allowed_sites, allowed_apps) VALUES ($1,$2,$3,$4,$5,$6)',
        [u.username, u.passwordHash, u.salt, u.role, u.allowedSites || [], u.allowedApps || []]
      );
      console.log(`  Restored user: ${u.username}`);
    }

    // Restore sites
    for (const site of (snapshot.sites || [])) {
      await client.query('INSERT INTO sites (id, name, app_id) VALUES ($1,$2,$3)', [site.id, site.name, site.appId || 1]);
      console.log(`  Restored site: ${site.name}`);
    }

    // Restore site states
    for (const [siteId, state] of Object.entries(snapshot.siteStates || {})) {
      await saveSiteStateWithClient(client, siteId, state);
      console.log(`  Restored state for site: ${siteId}`);
    }

    await client.query('COMMIT');
    console.log('\nRestore completed successfully.');
  } catch (e) {
    await client.query('ROLLBACK');
    throw new Error(`Restore failed (rolled back): ${e.message}`);
  } finally {
    client.release();
  }
}

// ========== MAIN ==========

async function main() {
  const args = process.argv.slice(2);

  // Handle --restore flag
  if (args[0] === '--restore') {
    const backupFile = args[1];
    if (!backupFile) {
      console.error('Usage: node migrate-to-db.js --restore <backup-file-path>');
      process.exit(1);
    }

    console.log('=== Task Tracker: Restore from Backup ===\n');
    try {
      await db.initDB();
      await restoreFromBackup(backupFile);
    } catch (e) {
      console.error('\nRestore failed:', e.message);
      process.exit(1);
    } finally {
      await db.pool.end();
    }
    return;
  }

  // Normal migration flow
  console.log('=== Task Tracker: JSON → PostgreSQL Migration ===\n');

  const client = await db.pool.connect();
  const backupFile = path.join(DATA_DIR, `backup-pre-migration-${Date.now()}.json`);

  try {
    // 1. Initialize schema (uses its own transaction internally)
    console.log('1. Creating database schema...');
    await db.initDB();
    console.log('   Done.\n');

    // 2. Snapshot current DB state
    console.log('2. Creating backup snapshot...');
    const snapshot = await captureDBSnapshot(client);
    // Ensure data directory exists
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }
    fs.writeFileSync(backupFile, JSON.stringify(snapshot, null, 2));
    console.log(`   Backup saved to ${backupFile}\n`);

    // 3. Migrate data within a transaction
    console.log('3. Migrating data from JSON files...');
    await client.query('BEGIN');
    await migrateFromJSONTransactional(client, DATA_DIR);
    await client.query('COMMIT');
    console.log('   Done.\n');

    console.log('=== Migration committed successfully! ===');
    console.log('\nYou can now start the server with: node server.js');
    console.log('The server will use PostgreSQL instead of JSON files.');
  } catch (e) {
    // Rollback transaction on failure
    try { await client.query('ROLLBACK'); } catch (_) { /* ignore rollback errors */ }
    console.error('\nMigration failed, transaction rolled back:', e.message);
    console.error(e.stack);
    if (fs.existsSync(backupFile)) {
      console.error(`\nBackup preserved at: ${backupFile}`);
      console.error(`To restore, run: node migrate-to-db.js --restore ${backupFile}`);
    }
    process.exit(1);
  } finally {
    client.release();
    await db.pool.end();
  }
}

main();
