const config = require('./config');
const express = require('express');
const path = require('path');
const fs = require('fs');
const db = require('./db');
const sessionStore = require('./middleware/sessionStore');
const bruteForceStore = require('./middleware/bruteForceStore');
const rateLimit = require('express-rate-limit');
const { setupSecurity } = require('./middleware/security');
const { globalErrorHandler } = require('./middleware/errorHandler');
const appState = require('./shared/appState');
const { hashPasswordSecure } = require('./routes/auth');

const app = express();
const PORT = config.port;
const DATA_DIR = path.join(__dirname, 'data');
const UPLOAD_DIR = path.join(__dirname, 'uploads');
const TRACKER_DIR = config.trackerDir;

[DATA_DIR, UPLOAD_DIR].forEach(d => { if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true }); });

// ========== SECURITY MIDDLEWARE ==========
setupSecurity(app);
app.set('trust proxy', 1);

// Rate limiting
app.use('/api/', rateLimit({
  windowMs: 15 * 60 * 1000, max: 200,
  standardHeaders: true, legacyHeaders: false,
  message: { error: 'Too many requests, please try again later.' }
}));
app.use('/api/login', rateLimit({
  windowMs: 15 * 60 * 1000, max: 10,
  skipSuccessfulRequests: true,
  message: { error: 'Too many login attempts. Try again in 15 minutes.' }
}));

app.use(express.json({ limit: '50mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// ========== ROUTE MODULES ==========
app.use('/api', require('./routes/auth'));
app.use('/api', require('./routes/users'));
app.use('/api', require('./routes/sites'));
app.use('/api', require('./routes/sections'));
app.use('/api', require('./routes/apps'));
app.use('/api', require('./routes/upload'));
app.use('/api', require('./routes/export'));
app.use('/api', require('./routes/state'));
app.use('/safety', require('./routes/safety'));
app.use('/users', require('./routes/usersApp'));

// ========== GLOBAL ERROR HANDLER (must be last middleware) ==========
app.use(globalErrorHandler);

// ========== PERIODIC CLEANUP ==========
setInterval(() => {
  sessionStore.cleanup().catch(err => console.error('Session cleanup error:', err));
}, 5 * 60 * 1000);

setInterval(() => {
  bruteForceStore.cleanup().catch(err => console.error('Brute force cleanup error:', err));
}, 5 * 60 * 1000);

// ========== AUTO-IMPORT ==========
function autoImportFromTrackerFolder() {
  const XLSX = require('xlsx');
  const { parseWeightWorkbook, parseInitialsWorkbook, parseTrackerWorkbook } = require('./routes/upload');
  const state = appState.getState();
  const pipe = state.sections.PIPE;
  if (pipe && pipe.rows && pipe.rows.length > 0) {
    console.log('PIPE section already has data, skipping auto-import.');
    return;
  }
  console.log('Auto-importing from Tracker folder:', TRACKER_DIR);
  try {
    const weightPath = path.join(TRACKER_DIR, 'WEIGHT.xlsx');
    if (fs.existsSync(weightPath)) {
      const wb = XLSX.readFile(weightPath);
      state.sections.PIPE.weights = parseWeightWorkbook(wb);
      console.log(`  Loaded ${state.sections.PIPE.weights.length} weight entries`);
    }
    const initialPath = path.join(TRACKER_DIR, 'INTIAL.xlsx');
    if (fs.existsSync(initialPath)) {
      const wb = XLSX.readFile(initialPath);
      state.initials = parseInitialsWorkbook(wb);
      console.log(`  Loaded ${state.initials.length} initials`);
    }
    const trackerPath = path.join(TRACKER_DIR, 'TACKER.xlsx');
    if (fs.existsSync(trackerPath)) {
      const wb = XLSX.readFile(trackerPath);
      const result = parseTrackerWorkbook(wb);
      Object.assign(state.sections.PIPE, result);
      state.sections.PIPE.label = 'PIPE';
      console.log(`  Loaded ${result.rows.length} rows, ${result.taskCols.length} task columns`);
    }
    db.saveSiteState(appState.getActiveSiteId(), state).catch(e => console.error('Auto-import save error:', e.message));
    console.log('Auto-import complete.');
  } catch (e) { console.error('Auto-import error:', e.message); }
}

// ========== STARTUP ==========
async function startServer() {
  try {
    console.log('Initializing PostgreSQL database...');
    await db.initDB();

    let users = await db.getUsers();
    if (!users.length) {
      const { hash, salt } = await hashPasswordSecure('admin123');
      await db.createUser('admin', hash, salt, 'superadmin', []);
      users = await db.getUsers();
      console.log('Created default super admin account (admin / admin123)');
    }
    if (!users.some(u => u.role === 'superadmin')) {
      const firstAdmin = users.find(u => u.role === 'admin');
      if (firstAdmin) {
        await db.updateUser(firstAdmin.username, { role: 'superadmin' });
        firstAdmin.role = 'superadmin';
        console.log('Migrated ' + firstAdmin.username + ' to superadmin');
      }
    }
    appState.setUsers(users);
    console.log(`Loaded ${users.length} users from database`);

    const allApps = await db.getApps();
    const safetyApp = allApps.find(a => a.name.toLowerCase() === 'safety');
    appState.setActiveAppId(safetyApp ? safetyApp.id : (allApps[0] ? allApps[0].id : 1));

    const trackerApp = allApps.find(a => a.name.toLowerCase() === 'task tracker');
    const trackerAppId = trackerApp ? trackerApp.id : appState.getActiveAppId();
    let sites = await db.getSites(trackerAppId);
    if (!sites.length) {
      const sitesFile = path.join(DATA_DIR, 'sites.json');
      if (fs.existsSync(sitesFile)) {
        console.log('Migrating existing JSON data to PostgreSQL...');
        await db.migrateFromJSON(DATA_DIR);
        const allSites = await db.getSites();
        for (const s of allSites) {
          if (!s.appId || s.appId === 1) {
            await db.pool.query('UPDATE sites SET app_id=$1 WHERE id=$2', [trackerAppId, s.id]);
          }
        }
        sites = await db.getSites(trackerAppId);
        appState.setUsers(await db.getUsers());
        console.log('Migration complete!');
      } else {
        await db.createSite('default', 'Default Site', trackerAppId);
        sites = await db.getSites(trackerAppId);
        console.log('Created default site');
      }
    }
    appState.setSites(sites);
    console.log(`Loaded ${sites.length} sites from database`);

    if (sites.length > 0) {
      appState.setActiveSiteId(sites[0].id);
      appState.setState(await db.loadSiteState(sites[0].id));
      console.log(`Active site: ${sites[0].name} (${sites[0].id})`);
    } else {
      console.log('No sites loaded (Safety/Users app has no sites)');
    }

    if (TRACKER_DIR) {
      autoImportFromTrackerFolder();
    }

    app.listen(PORT, () => {
      console.log(`Task Tracker running at http://localhost:${PORT}`);
      console.log(`Database: PostgreSQL (${process.env.DB_HOST || 'localhost'}:${process.env.DB_PORT || 5432}/${process.env.DB_NAME || 'task_tracker'})`);
    });

  } catch (e) {
    console.error('Failed to start server:', e.message);
    console.error(e.stack);
    process.exit(1);
  }
}

startServer();
