const { Pool } = require('pg');
const config = require('./config');

const DB_CONFIG = config.db;

const pool = new Pool(DB_CONFIG);

// ========== SCHEMA CREATION ==========
async function initDB() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Users table
    await client.query(`
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        username VARCHAR(100) UNIQUE NOT NULL,
        password_hash VARCHAR(255) NOT NULL,
        salt VARCHAR(255) NOT NULL,
        role VARCHAR(20) NOT NULL DEFAULT 'user' CHECK (role IN ('superadmin','admin','user')),
        allowed_sites TEXT[] DEFAULT '{}',
        allowed_apps INTEGER[] DEFAULT '{}',
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      )
    `);

    // Add allowed_apps column if it doesn't exist (migration for existing DBs)
    await client.query(`
      DO $$ BEGIN
        ALTER TABLE users ADD COLUMN IF NOT EXISTS allowed_apps INTEGER[] DEFAULT '{}';
      EXCEPTION WHEN duplicate_column THEN NULL;
      END $$
    `);

    // Sites table
    await client.query(`
      CREATE TABLE IF NOT EXISTS sites (
        id VARCHAR(100) PRIMARY KEY,
        name VARCHAR(255) NOT NULL,
        app_id INTEGER DEFAULT 1,
        created_at TIMESTAMP DEFAULT NOW()
      )
    `);

    // Add app_id column if it doesn't exist (migration for existing DBs)
    await client.query(`
      DO $$ BEGIN
        ALTER TABLE sites ADD COLUMN IF NOT EXISTS app_id INTEGER DEFAULT 1;
      EXCEPTION WHEN duplicate_column THEN NULL;
      END $$
    `);

    // Sections table (per site)
    await client.query(`
      CREATE TABLE IF NOT EXISTS sections (
        id SERIAL PRIMARY KEY,
        site_id VARCHAR(100) NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
        name VARCHAR(100) NOT NULL,
        label VARCHAR(100) NOT NULL,
        original_headers JSONB DEFAULT '[]',
        created_at TIMESTAMP DEFAULT NOW(),
        UNIQUE(site_id, name)
      )
    `);

    // Initials table (per site)
    await client.query(`
      CREATE TABLE IF NOT EXISTS initials (
        id SERIAL PRIMARY KEY,
        site_id VARCHAR(100) NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
        initial VARCHAR(20) NOT NULL,
        name VARCHAR(255) NOT NULL,
        UNIQUE(site_id, initial)
      )
    `);

    // Weight table (per section)
    await client.query(`
      CREATE TABLE IF NOT EXISTS weights (
        id SERIAL PRIMARY KEY,
        section_id INTEGER NOT NULL REFERENCES sections(id) ON DELETE CASCADE,
        task VARCHAR(500) NOT NULL,
        tracker_col VARCHAR(500) NOT NULL,
        weight DECIMAL(10,4) DEFAULT 0,
        minutes DECIMAL(10,4) DEFAULT 0
      )
    `);

    // Info columns definition (per section)
    await client.query(`
      CREATE TABLE IF NOT EXISTS info_cols (
        id SERIAL PRIMARY KEY,
        section_id INTEGER NOT NULL REFERENCES sections(id) ON DELETE CASCADE,
        name VARCHAR(500) NOT NULL,
        col_index INTEGER NOT NULL
      )
    `);

    // Task columns definition (per section)
    await client.query(`
      CREATE TABLE IF NOT EXISTS task_cols (
        id SERIAL PRIMARY KEY,
        section_id INTEGER NOT NULL REFERENCES sections(id) ON DELETE CASCADE,
        task VARCHAR(500) NOT NULL,
        date_col INTEGER,
        init_col INTEGER,
        date_header VARCHAR(500),
        init_header VARCHAR(500)
      )
    `);

    // Tracker rows (per section) - asset/equipment rows
    await client.query(`
      CREATE TABLE IF NOT EXISTS tracker_rows (
        id SERIAL PRIMARY KEY,
        section_id INTEGER NOT NULL REFERENCES sections(id) ON DELETE CASCADE,
        row_index INTEGER NOT NULL,
        info_data JSONB DEFAULT '{}',
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      )
    `);

    // Task entries (per tracker row) - date/initial for each task
    await client.query(`
      CREATE TABLE IF NOT EXISTS task_entries (
        id SERIAL PRIMARY KEY,
        row_id INTEGER NOT NULL REFERENCES tracker_rows(id) ON DELETE CASCADE,
        task_name VARCHAR(500) NOT NULL,
        date_val VARCHAR(50) DEFAULT '',
        initial VARCHAR(20) DEFAULT '',
        updated_at TIMESTAMP DEFAULT NOW(),
        UNIQUE(row_id, task_name)
      )
    `);

    // Billing data (per site)
    await client.query(`
      CREATE TABLE IF NOT EXISTS billing (
        id SERIAL PRIMARY KEY,
        site_id VARCHAR(100) NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
        po_amount DECIMAL(12,2) DEFAULT 0,
        rate DECIMAL(12,2) DEFAULT 0,
        UNIQUE(site_id)
      )
    `);

    // Billing timesheet rows (per site)
    await client.query(`
      CREATE TABLE IF NOT EXISTS billing_timesheet (
        id SERIAL PRIMARY KEY,
        site_id VARCHAR(100) NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
        week VARCHAR(100) DEFAULT '',
        st DECIMAL(10,2) DEFAULT 0,
        ot DECIMAL(10,2) DEFAULT 0,
        total_hrs DECIMAL(10,2) DEFAULT 0,
        equip DECIMAL(12,2) DEFAULT 0,
        total_cost DECIMAL(12,2) DEFAULT 0,
        notes TEXT DEFAULT '',
        row_index INTEGER DEFAULT 0
      )
    `);

    // Site state metadata (active section, page, pageSize per site)
    await client.query(`
      CREATE TABLE IF NOT EXISTS site_meta (
        site_id VARCHAR(100) PRIMARY KEY REFERENCES sites(id) ON DELETE CASCADE,
        active_section VARCHAR(100) DEFAULT 'PIPE',
        page INTEGER DEFAULT 0,
        page_size INTEGER DEFAULT 100
      )
    `);

    // Apps table (sidebar modules)
    await client.query(`
      CREATE TABLE IF NOT EXISTS apps (
        id SERIAL PRIMARY KEY,
        name VARCHAR(255) NOT NULL,
        icon VARCHAR(50) DEFAULT 'folder',
        sort_order INTEGER DEFAULT 0,
        is_builtin BOOLEAN DEFAULT false,
        created_at TIMESTAMP DEFAULT NOW()
      )
    `);

    // Seed default apps if empty
    const appCount = await client.query('SELECT COUNT(*) FROM apps');
    if (parseInt(appCount.rows[0].count) === 0) {
      await client.query(`INSERT INTO apps (name, icon, sort_order, is_builtin) VALUES ('Safety', 'shield', 0, true)`);
      await client.query(`INSERT INTO apps (name, icon, sort_order, is_builtin) VALUES ('Task Tracker', 'clipboard', 1, false)`);
    }

    // Seed Users app if missing
    const usersAppCheck = await client.query(`SELECT id FROM apps WHERE LOWER(name)='users'`);
    if (usersAppCheck.rows.length === 0) {
      const maxSort = await client.query('SELECT COALESCE(MAX(sort_order), 0) + 1 as next FROM apps');
      await client.query(`INSERT INTO apps (name, icon, sort_order, is_builtin) VALUES ('Users', 'users', $1, true)`, [maxSort.rows[0].next]);
    } else {
      // Ensure Users app is built-in
      await client.query(`UPDATE apps SET is_builtin = true WHERE LOWER(name)='users'`);
    }

    // Seed Reports app if missing (not built-in so it can be assigned per user)
    const reportsAppCheck = await client.query(`SELECT id FROM apps WHERE LOWER(name)='reports'`);
    if (reportsAppCheck.rows.length === 0) {
      const maxSortR = await client.query('SELECT COALESCE(MAX(sort_order), 0) + 1 as next FROM apps');
      await client.query(`INSERT INTO apps (name, icon, sort_order, is_builtin) VALUES ('Reports', 'report', $1, false)`, [maxSortR.rows[0].next]);
    } else {
      // Ensure Reports is NOT built-in so it's assignable per user
      await client.query(`UPDATE apps SET is_builtin = false WHERE LOWER(name)='reports'`);
    }

    // Migration: ensure Safety is built-in and Task Tracker is assignable
    const safetyCheck = await client.query(`SELECT id FROM apps WHERE LOWER(name)='safety' AND is_builtin=true`);
    if (safetyCheck.rows.length === 0) {
      await client.query(`UPDATE apps SET is_builtin=false WHERE LOWER(name)='task tracker'`);
      const safetyExists = await client.query(`SELECT id FROM apps WHERE LOWER(name)='safety'`);
      if (safetyExists.rows.length > 0) {
        await client.query(`UPDATE apps SET is_builtin=true WHERE LOWER(name)='safety'`);
      } else {
        await client.query(`INSERT INTO apps (name, icon, sort_order, is_builtin) VALUES ('Safety', 'shield', 0, true)`);
      }
    }

    // Migration: ensure Safety is always first in sidebar (sort_order = 0)
    const safetySort = await client.query(`SELECT id, sort_order FROM apps WHERE LOWER(name)='safety'`);
    if (safetySort.rows.length > 0 && safetySort.rows[0].sort_order !== 0) {
      await client.query(`UPDATE apps SET sort_order = sort_order + 1 WHERE sort_order >= 0`);
      await client.query(`UPDATE apps SET sort_order = 0 WHERE id = $1`, [safetySort.rows[0].id]);
    }

    // Migration: assign existing sites to Task Tracker app if app_id is still default 1
    const trackerApp = await client.query(`SELECT id FROM apps WHERE LOWER(name)='task tracker'`);
    if (trackerApp.rows.length > 0) {
      const trackerId = trackerApp.rows[0].id;
      // Update any sites with default app_id=1 to Task Tracker's actual ID (in case it's not 1)
      if (trackerId !== 1) {
        await client.query(`UPDATE sites SET app_id=$1 WHERE app_id=1 OR app_id IS NULL`, [trackerId]);
      }
    }

    // JSA Records table (for Safety app)
    await client.query(`
      CREATE TABLE IF NOT EXISTS jsa_records (
        id SERIAL PRIMARY KEY,
        site_name VARCHAR(255) NOT NULL,
        description_of_work TEXT,
        saved_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        pdf_data BYTEA NOT NULL,
        file_size INTEGER,
        created_by VARCHAR(255) DEFAULT 'system'
      )
    `);

    // Sessions table (persistent session storage)
    await client.query(`
      CREATE TABLE IF NOT EXISTS sessions (
        token VARCHAR(64) PRIMARY KEY,
        username VARCHAR(100) NOT NULL,
        role VARCHAR(20) NOT NULL,
        created_at TIMESTAMP DEFAULT NOW(),
        last_activity TIMESTAMP DEFAULT NOW(),
        expires_at TIMESTAMP NOT NULL
      )
    `);

    // Login attempts table (persistent brute force tracking)
    await client.query(`
      CREATE TABLE IF NOT EXISTS login_attempts (
        key VARCHAR(255) PRIMARY KEY,
        attempt_count INTEGER DEFAULT 0,
        locked_until TIMESTAMP,
        last_attempt TIMESTAMP DEFAULT NOW()
      )
    `);

    // Audit log table
    await client.query(`
      CREATE TABLE IF NOT EXISTS audit_log (
        id SERIAL PRIMARY KEY,
        action VARCHAR(100) NOT NULL,
        username VARCHAR(100),
        ip_address VARCHAR(45),
        details JSONB DEFAULT '{}',
        created_at TIMESTAMP DEFAULT NOW()
      )
    `);

    // Create indexes for performance
    await client.query(`CREATE INDEX IF NOT EXISTS idx_sections_site ON sections(site_id)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_initials_site ON initials(site_id)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_weights_section ON weights(section_id)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_info_cols_section ON info_cols(section_id)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_task_cols_section ON task_cols(section_id)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_tracker_rows_section ON tracker_rows(section_id)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_task_entries_row ON task_entries(row_id)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_billing_ts_site ON billing_timesheet(site_id)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_jsa_records_saved ON jsa_records(saved_at DESC)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions(expires_at)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_sessions_username ON sessions(username)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_audit_log_action ON audit_log(action)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_audit_log_created ON audit_log(created_at DESC)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_audit_log_username ON audit_log(username)`);

    await client.query('COMMIT');
    console.log('Database schema initialized successfully');
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}

// ========== USER OPERATIONS ==========
async function getUsers() {
  const { rows } = await pool.query('SELECT username, password_hash, salt, role, allowed_sites, allowed_apps FROM users ORDER BY id');
  return rows.map(r => ({ username: r.username, passwordHash: r.password_hash, salt: r.salt, role: r.role, allowedSites: r.allowed_sites || [], allowedApps: (r.allowed_apps || []).map(Number) }));
}

async function createUser(username, passwordHash, salt, role, allowedSites, allowedApps) {
  await pool.query(
    'INSERT INTO users (username, password_hash, salt, role, allowed_sites, allowed_apps) VALUES ($1,$2,$3,$4,$5,$6)',
    [username, passwordHash, salt, role, allowedSites || [], allowedApps || []]
  );
}

async function updateUser(username, fields) {
  const sets = [];
  const vals = [];
  let i = 1;
  if (fields.passwordHash !== undefined) { sets.push(`password_hash=$${i++}`); vals.push(fields.passwordHash); }
  if (fields.salt !== undefined) { sets.push(`salt=$${i++}`); vals.push(fields.salt); }
  if (fields.role !== undefined) { sets.push(`role=$${i++}`); vals.push(fields.role); }
  if (fields.allowedSites !== undefined) { sets.push(`allowed_sites=$${i++}`); vals.push(fields.allowedSites); }
  if (fields.allowedApps !== undefined) { sets.push(`allowed_apps=$${i++}`); vals.push(fields.allowedApps); }
  sets.push(`updated_at=NOW()`);
  vals.push(username);
  await pool.query(`UPDATE users SET ${sets.join(',')} WHERE LOWER(username)=LOWER($${i})`, vals);
}

async function deleteUser(username) {
  await pool.query('DELETE FROM users WHERE LOWER(username)=LOWER($1)', [username]);
}

// ========== SITE OPERATIONS ==========
async function getSites(appId) {
  if (appId) {
    const { rows } = await pool.query('SELECT id, name, app_id FROM sites WHERE app_id=$1 ORDER BY created_at', [appId]);
    return rows.map(r => ({ id: r.id, name: r.name, appId: r.app_id }));
  }
  const { rows } = await pool.query('SELECT id, name, app_id FROM sites ORDER BY created_at');
  return rows.map(r => ({ id: r.id, name: r.name, appId: r.app_id }));
}

async function createSite(id, name, appId) {
  await pool.query('INSERT INTO sites (id, name, app_id) VALUES ($1,$2,$3)', [id, name, appId || 1]);
  // Create default sections
  for (const sec of ['PIPE', 'PV', 'PSV']) {
    await pool.query('INSERT INTO sections (site_id, name, label) VALUES ($1,$2,$3)', [id, sec, sec]);
  }
  // Create meta
  await pool.query('INSERT INTO site_meta (site_id) VALUES ($1)', [id]);
  // Create billing
  await pool.query('INSERT INTO billing (site_id) VALUES ($1)', [id]);
}

async function deleteSite(siteId) {
  await pool.query('DELETE FROM sites WHERE id=$1', [siteId]);
}

async function renameSite(siteId, newName) {
  await pool.query('UPDATE sites SET name=$1 WHERE id=$2', [newName, siteId]);
}

// ========== LOAD FULL SITE STATE (for API compatibility) ==========
async function loadSiteState(siteId) {
  const client = await pool.connect();
  try {
    // Get meta
    const metaRes = await client.query('SELECT * FROM site_meta WHERE site_id=$1', [siteId]);
    const meta = metaRes.rows[0] || { active_section: 'PIPE', page: 0, page_size: 100 };

    // Get initials
    const initRes = await client.query('SELECT initial, name FROM initials WHERE site_id=$1 ORDER BY id', [siteId]);

    // Get sections
    const secRes = await client.query('SELECT id, name, label, original_headers FROM sections WHERE site_id=$1 ORDER BY id', [siteId]);
    const sections = {};

    for (const sec of secRes.rows) {
      // Weights
      const wRes = await client.query('SELECT task, tracker_col, weight, minutes FROM weights WHERE section_id=$1 ORDER BY id', [sec.id]);
      // Info cols
      const icRes = await client.query('SELECT name, col_index FROM info_cols WHERE section_id=$1 ORDER BY col_index', [sec.id]);
      // Task cols
      const tcRes = await client.query('SELECT task, date_col, init_col, date_header, init_header FROM task_cols WHERE section_id=$1 ORDER BY id', [sec.id]);
      // Rows
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

    // Get billing
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
  } finally {
    client.release();
  }
}

// ========== SAVE FULL SITE STATE (for API compatibility) ==========
async function saveSiteState(siteId, state) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Upsert meta
    await client.query(`
      INSERT INTO site_meta (site_id, active_section, page, page_size) VALUES ($1,$2,$3,$4)
      ON CONFLICT (site_id) DO UPDATE SET active_section=$2, page=$3, page_size=$4
    `, [siteId, state.activeSection || 'PIPE', state.page || 0, state.pageSize || 100]);

    // Upsert initials - clear and re-insert
    await client.query('DELETE FROM initials WHERE site_id=$1', [siteId]);
    for (const ini of (state.initials || [])) {
      await client.query('INSERT INTO initials (site_id, initial, name) VALUES ($1,$2,$3) ON CONFLICT (site_id, initial) DO UPDATE SET name=$3', [siteId, ini.initial, ini.name]);
    }

    // Get existing sections for this site
    const existingSecRes = await client.query('SELECT id, name FROM sections WHERE site_id=$1', [siteId]);
    const existingSecs = {};
    existingSecRes.rows.forEach(r => { existingSecs[r.name] = r.id; });

    // Process each section
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

      // Clear and re-insert weights
      await client.query('DELETE FROM weights WHERE section_id=$1', [sectionId]);
      for (const w of (secData.weights || [])) {
        await client.query('INSERT INTO weights (section_id, task, tracker_col, weight, minutes) VALUES ($1,$2,$3,$4,$5)',
          [sectionId, w.task, w.trackerCol, w.weight || 0, w.minutes || 0]);
      }

      // Clear and re-insert info cols
      await client.query('DELETE FROM info_cols WHERE section_id=$1', [sectionId]);
      for (let i = 0; i < (secData.infoCols || []).length; i++) {
        const c = secData.infoCols[i];
        await client.query('INSERT INTO info_cols (section_id, name, col_index) VALUES ($1,$2,$3)',
          [sectionId, c.name, c.index !== undefined ? c.index : i]);
      }

      // Clear and re-insert task cols
      await client.query('DELETE FROM task_cols WHERE section_id=$1', [sectionId]);
      for (const tc of (secData.taskCols || [])) {
        await client.query('INSERT INTO task_cols (section_id, task, date_col, init_col, date_header, init_header) VALUES ($1,$2,$3,$4,$5,$6)',
          [sectionId, tc.task, tc.dateCol, tc.initCol, tc.dateHeader, tc.initHeader]);
      }

      // Clear and re-insert rows + task entries
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

    // Upsert billing
    const billing = state.billing || {};
    await client.query(`
      INSERT INTO billing (site_id, po_amount, rate) VALUES ($1,$2,$3)
      ON CONFLICT (site_id) DO UPDATE SET po_amount=$2, rate=$3
    `, [siteId, billing.po || 0, billing.rate || 0]);

    // Clear and re-insert timesheet
    await client.query('DELETE FROM billing_timesheet WHERE site_id=$1', [siteId]);
    for (let i = 0; i < (billing.timesheet || []).length; i++) {
      const t = billing.timesheet[i];
      await client.query(
        'INSERT INTO billing_timesheet (site_id, week, st, ot, total_hrs, equip, total_cost, notes, row_index) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)',
        [siteId, t.week || '', t.st || 0, t.ot || 0, t.totalHrs || 0, t.equip || 0, t.totalCost || 0, t.notes || '', i]
      );
    }

    await client.query('COMMIT');
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}

// ========== SECTION-SPECIFIC OPERATIONS (optimized) ==========
async function getSectionId(siteId, sectionName) {
  const { rows } = await pool.query('SELECT id FROM sections WHERE site_id=$1 AND name=$2', [siteId, sectionName]);
  return rows[0] ? rows[0].id : null;
}

async function saveSectionWeights(siteId, sectionName, weights) {
  const sectionId = await getSectionId(siteId, sectionName);
  if (!sectionId) return;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('DELETE FROM weights WHERE section_id=$1', [sectionId]);
    for (const w of weights) {
      await client.query('INSERT INTO weights (section_id, task, tracker_col, weight, minutes) VALUES ($1,$2,$3,$4,$5)',
        [sectionId, w.task, w.trackerCol, w.weight || 0, w.minutes || 0]);
    }
    await client.query('COMMIT');
  } catch (e) { await client.query('ROLLBACK'); throw e; }
  finally { client.release(); }
}

async function saveInitials(siteId, initials) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('DELETE FROM initials WHERE site_id=$1', [siteId]);
    for (const ini of initials) {
      await client.query('INSERT INTO initials (site_id, initial, name) VALUES ($1,$2,$3)', [siteId, ini.initial, ini.name]);
    }
    await client.query('COMMIT');
  } catch (e) { await client.query('ROLLBACK'); throw e; }
  finally { client.release(); }
}

async function createSection(siteId, name, label) {
  await pool.query('INSERT INTO sections (site_id, name, label) VALUES ($1,$2,$3)', [siteId, name, label || name]);
}

async function deleteSection(siteId, name) {
  await pool.query('DELETE FROM sections WHERE site_id=$1 AND name=$2', [siteId, name]);
}

// ========== APP MODULE OPERATIONS ==========
async function getApps() {
  const { rows } = await pool.query('SELECT id, name, icon, sort_order, is_builtin FROM apps ORDER BY sort_order, id');
  return rows.map(r => ({ id: r.id, name: r.name, icon: r.icon, sortOrder: r.sort_order, isBuiltin: r.is_builtin }));
}

async function createApp(name, icon) {
  const maxOrder = await pool.query('SELECT COALESCE(MAX(sort_order), 0) + 1 as next_order FROM apps');
  const nextOrder = maxOrder.rows[0].next_order;
  const { rows } = await pool.query(
    'INSERT INTO apps (name, icon, sort_order, is_builtin) VALUES ($1, $2, $3, false) RETURNING id, name, icon, sort_order, is_builtin',
    [name, icon || 'folder', nextOrder]
  );
  const r = rows[0];
  return { id: r.id, name: r.name, icon: r.icon, sortOrder: r.sort_order, isBuiltin: r.is_builtin };
}

async function updateApp(id, fields) {
  const sets = [];
  const vals = [];
  let i = 1;
  if (fields.name !== undefined) { sets.push(`name=$${i++}`); vals.push(fields.name); }
  if (fields.icon !== undefined) { sets.push(`icon=$${i++}`); vals.push(fields.icon); }
  if (fields.sortOrder !== undefined) { sets.push(`sort_order=$${i++}`); vals.push(fields.sortOrder); }
  if (!sets.length) return;
  vals.push(id);
  await pool.query(`UPDATE apps SET ${sets.join(',')} WHERE id=$${i}`, vals);
}

async function deleteApp(id) {
  // Don't delete built-in apps
  const check = await pool.query('SELECT is_builtin FROM apps WHERE id=$1', [id]);
  if (check.rows.length && check.rows[0].is_builtin) {
    throw new Error('Cannot delete built-in application');
  }
  await pool.query('DELETE FROM apps WHERE id=$1', [id]);
}

// ========== JSA RECORD OPERATIONS (Safety App) ==========
async function saveJsaRecord(siteName, descriptionOfWork, pdfBuffer) {
  const result = await pool.query(
    `INSERT INTO jsa_records (site_name, description_of_work, pdf_data, file_size)
     VALUES ($1, $2, $3, $4)
     RETURNING id, site_name, saved_at, file_size`,
    [siteName, descriptionOfWork || '', pdfBuffer, pdfBuffer.length]
  );
  const r = result.rows[0];
  return { id: r.id, siteName: r.site_name, savedAt: r.saved_at, fileSize: r.file_size };
}

async function getJsaRecords() {
  const { rows } = await pool.query(
    `SELECT id, site_name, description_of_work, saved_at, file_size
     FROM jsa_records ORDER BY saved_at DESC`
  );
  return rows.map(r => ({ id: r.id, siteName: r.site_name, descriptionOfWork: r.description_of_work, savedAt: r.saved_at, fileSize: r.file_size }));
}

async function getJsaRecordPdf(id) {
  const { rows } = await pool.query(
    'SELECT pdf_data, site_name, saved_at FROM jsa_records WHERE id = $1',
    [id]
  );
  if (rows.length === 0) return null;
  const r = rows[0];
  return { pdfData: r.pdf_data, siteName: r.site_name, savedAt: r.saved_at };
}

async function deleteJsaRecord(id) {
  const { rowCount } = await pool.query('DELETE FROM jsa_records WHERE id = $1', [id]);
  return rowCount > 0;
}

// ========== PAGINATED QUERY OPERATIONS ==========
async function getTrackerRowsPaginated(sectionId, offset, limit) {
  const countRes = await pool.query(
    'SELECT COUNT(*) FROM tracker_rows WHERE section_id=$1',
    [sectionId]
  );
  const total = parseInt(countRes.rows[0].count, 10);

  const rowRes = await pool.query(
    'SELECT id, row_index, info_data FROM tracker_rows WHERE section_id=$1 ORDER BY row_index LIMIT $2 OFFSET $3',
    [sectionId, limit, offset]
  );

  const rows = [];
  for (const row of rowRes.rows) {
    const teRes = await pool.query(
      'SELECT task_name, date_val, initial FROM task_entries WHERE row_id=$1',
      [row.id]
    );
    const tasks = {};
    teRes.rows.forEach(te => {
      tasks[te.task_name] = { date: te.date_val || '', initial: te.initial || '' };
    });
    rows.push({ _info: row.info_data || {}, _tasks: tasks, rowIndex: row.row_index });
  }

  return { rows, total };
}

async function getAuditLogPaginated(offset, limit, filters = {}) {
  const conditions = [];
  const params = [];
  let paramIndex = 1;

  if (filters.action) {
    conditions.push(`action = $${paramIndex++}`);
    params.push(filters.action);
  }
  if (filters.username) {
    conditions.push(`username = $${paramIndex++}`);
    params.push(filters.username);
  }
  if (filters.startDate) {
    conditions.push(`created_at >= $${paramIndex++}`);
    params.push(filters.startDate);
  }
  if (filters.endDate) {
    conditions.push(`created_at <= $${paramIndex++}`);
    params.push(filters.endDate);
  }

  const whereClause = conditions.length > 0 ? 'WHERE ' + conditions.join(' AND ') : '';

  const countRes = await pool.query(
    `SELECT COUNT(*) FROM audit_log ${whereClause}`,
    params
  );
  const total = parseInt(countRes.rows[0].count, 10);

  const dataParams = [...params, limit, offset];
  const rowRes = await pool.query(
    `SELECT id, action, username, ip_address, details, created_at FROM audit_log ${whereClause} ORDER BY created_at DESC LIMIT $${paramIndex++} OFFSET $${paramIndex++}`,
    dataParams
  );

  return {
    rows: rowRes.rows.map(r => ({
      id: r.id,
      action: r.action,
      username: r.username,
      ipAddress: r.ip_address,
      details: r.details,
      createdAt: r.created_at
    })),
    total
  };
}

async function getJsaRecordsPaginated(offset, limit) {
  const countRes = await pool.query('SELECT COUNT(*) FROM jsa_records');
  const total = parseInt(countRes.rows[0].count, 10);

  const { rows } = await pool.query(
    'SELECT id, site_name, description_of_work, saved_at, file_size FROM jsa_records ORDER BY saved_at DESC LIMIT $1 OFFSET $2',
    [limit, offset]
  );

  return {
    rows: rows.map(r => ({ id: r.id, siteName: r.site_name, descriptionOfWork: r.description_of_work, savedAt: r.saved_at, fileSize: r.file_size })),
    total
  };
}

// ========== MIGRATION: JSON → PostgreSQL ==========
async function migrateFromJSON(dataDir) {
  const fs = require('fs');
  const path = require('path');

  // Migrate users
  const usersFile = path.join(dataDir, 'users.json');
  if (fs.existsSync(usersFile)) {
    const users = JSON.parse(fs.readFileSync(usersFile, 'utf8'));
    for (const u of users) {
      try {
        await createUser(u.username, u.passwordHash, u.salt, u.role || 'user', u.allowedSites || []);
        console.log(`  Migrated user: ${u.username} (${u.role})`);
      } catch (e) {
        if (e.code === '23505') console.log(`  User ${u.username} already exists, skipping`);
        else throw e;
      }
    }
  }

  // Migrate sites
  const sitesFile = path.join(dataDir, 'sites.json');
  if (fs.existsSync(sitesFile)) {
    const sites = JSON.parse(fs.readFileSync(sitesFile, 'utf8'));
    for (const site of sites) {
      try {
        // Create site without default sections (we'll import from state file)
        await pool.query('INSERT INTO sites (id, name) VALUES ($1,$2)', [site.id, site.name]);
        await pool.query('INSERT INTO site_meta (site_id) VALUES ($1) ON CONFLICT DO NOTHING', [site.id]);
        await pool.query('INSERT INTO billing (site_id) VALUES ($1) ON CONFLICT DO NOTHING', [site.id]);
        console.log(`  Migrated site: ${site.name} (${site.id})`);
      } catch (e) {
        if (e.code === '23505') console.log(`  Site ${site.name} already exists, skipping`);
        else throw e;
      }

      // Migrate site state
      const stateFile = path.join(dataDir, `state-${site.id}.json`);
      if (fs.existsSync(stateFile)) {
        try {
          const state = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
          await saveSiteState(site.id, state);
          console.log(`  Migrated state for site: ${site.name}`);
        } catch (e) {
          console.error(`  Error migrating state for ${site.name}:`, e.message);
        }
      }
    }
  }
}

module.exports = {
  pool,
  initDB,
  getUsers, createUser, updateUser, deleteUser,
  getSites, createSite, deleteSite, renameSite,
  loadSiteState, saveSiteState,
  getSectionId, saveSectionWeights, saveInitials,
  createSection, deleteSection,
  getApps, createApp, updateApp, deleteApp,
  saveJsaRecord, getJsaRecords, getJsaRecordPdf, deleteJsaRecord,
  getTrackerRowsPaginated, getAuditLogPaginated, getJsaRecordsPaginated,
  migrateFromJSON
};
