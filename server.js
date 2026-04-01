const express = require('express');
const multer = require('multer');
const XLSX = require('xlsx');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

const app = express();
const PORT = process.env.PORT || 3002;

// Directories
const DATA_DIR = path.join(__dirname, 'data');
const STATE_FILE = path.join(DATA_DIR, 'state.json');
const USERS_FILE = path.join(DATA_DIR, 'users.json');
const UPLOAD_DIR = path.join(__dirname, 'uploads');
const TRACKER_DIR = 'C:/Users/Ramii/OneDrive - fixedequipmentreliability.com/Documents/Tracker';

[DATA_DIR, UPLOAD_DIR].forEach(d => { if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true }); });

const upload = multer({ dest: UPLOAD_DIR });

app.use(express.json({ limit: '50mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// ========== AUTH SYSTEM ==========
const sessions = {};

function hashPassword(password, salt) {
  if (!salt) salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.createHash('sha256').update(salt + password).digest('hex');
  return { hash, salt };
}

function verifyPassword(password, storedHash, salt) {
  const { hash } = hashPassword(password, salt);
  return hash === storedHash;
}

function loadUsers() {
  try {
    if (fs.existsSync(USERS_FILE)) return JSON.parse(fs.readFileSync(USERS_FILE, 'utf8'));
  } catch (e) { console.error('Error loading users:', e.message); }
  return null;
}

function saveUsers(users) {
  fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 2), 'utf8');
}

function initUsers() {
  let users = loadUsers();
  if (!users || !users.length) {
    const { hash, salt } = hashPassword('admin123');
    users = [{ username: 'admin', passwordHash: hash, salt, role: 'superadmin', allowedSites: [] }];
    saveUsers(users);
    console.log('Created default super admin account (admin / admin123)');
  } else {
    // Migrate: upgrade old 'admin' role users to 'superadmin' if no superadmin exists
    const hasSuperAdmin = users.some(u => u.role === 'superadmin');
    if (!hasSuperAdmin) {
      const firstAdmin = users.find(u => u.role === 'admin');
      if (firstAdmin) { firstAdmin.role = 'superadmin'; firstAdmin.allowedSites = []; saveUsers(users); console.log('Migrated ' + firstAdmin.username + ' to superadmin'); }
    }
    // Ensure all users have allowedSites array
    users.forEach(u => { if (!u.allowedSites) u.allowedSites = []; });
  }
  return users;
}

let users = initUsers();

function generateToken() { return crypto.randomBytes(32).toString('hex'); }

function authRequired(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) return res.status(401).json({ error: 'Authentication required' });
  const session = sessions[authHeader.slice(7)];
  if (!session) return res.status(401).json({ error: 'Invalid or expired session' });
  req.user = session;
  next();
}

function adminRequired(req, res, next) {
  if (req.user.role !== 'admin' && req.user.role !== 'superadmin') return res.status(403).json({ error: 'Admin access required' });
  next();
}

function superAdminRequired(req, res, next) {
  if (req.user.role !== 'superadmin') return res.status(403).json({ error: 'Super Admin access required' });
  next();
}

// Check if user has access to the currently active site
function siteAccessRequired(req, res, next) {
  if (req.user.role === 'superadmin') return next(); // superadmin has all access
  const userRecord = users.find(u => u.username.toLowerCase() === req.user.username.toLowerCase());
  if (!userRecord) return res.status(403).json({ error: 'User not found' });
  if (req.user.role === 'admin') {
    // Admin can only access their allowed sites
    if (userRecord.allowedSites && userRecord.allowedSites.length > 0 && !userRecord.allowedSites.includes(activeSiteId)) {
      return res.status(403).json({ error: 'No access to this site' });
    }
  }
  next();
}

// ========== AUTH ROUTES ==========
app.post('/api/login', (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) return res.status(400).json({ error: 'Username and password required' });
  const user = users.find(u => u.username.toLowerCase() === username.toLowerCase());
  if (!user || !verifyPassword(password, user.passwordHash, user.salt)) return res.status(401).json({ error: 'Invalid username or password' });
  const token = generateToken();
  sessions[token] = { username: user.username, role: user.role, created: Date.now() };
  res.json({ ok: true, token, username: user.username, role: user.role, allowedSites: user.allowedSites || [] });
});

app.post('/api/logout', (req, res) => {
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) delete sessions[authHeader.slice(7)];
  res.json({ ok: true });
});

app.get('/api/me', authRequired, (req, res) => {
  const userRecord = users.find(u => u.username.toLowerCase() === req.user.username.toLowerCase());
  res.json({ username: req.user.username, role: req.user.role, allowedSites: userRecord ? userRecord.allowedSites || [] : [] });
});

// User management
app.get('/api/users', authRequired, adminRequired, (req, res) => {
  res.json(users.map(u => ({ username: u.username, role: u.role, allowedSites: u.allowedSites || [] })));
});

app.post('/api/users', authRequired, adminRequired, (req, res) => {
  const { username, password, role, allowedSites } = req.body;
  if (!username || !password) return res.status(400).json({ error: 'Username and password required' });
  const validRoles = ['superadmin', 'admin', 'user'];
  if (!validRoles.includes(role)) return res.status(400).json({ error: 'Role must be superadmin, admin, or user' });
  // Only superadmin can create superadmin or admin users
  if ((role === 'superadmin' || role === 'admin') && req.user.role !== 'superadmin') return res.status(403).json({ error: 'Only Super Admin can create admin/superadmin users' });
  if (users.find(u => u.username.toLowerCase() === username.toLowerCase())) return res.status(400).json({ error: 'Username already exists' });
  const { hash, salt } = hashPassword(password);
  users.push({ username, passwordHash: hash, salt, role, allowedSites: allowedSites || [] });
  saveUsers(users);
  res.json({ ok: true });
});

app.delete('/api/users/:username', authRequired, superAdminRequired, (req, res) => {
  const target = req.params.username;
  if (target.toLowerCase() === req.user.username.toLowerCase()) return res.status(400).json({ error: 'Cannot delete your own account' });
  const idx = users.findIndex(u => u.username.toLowerCase() === target.toLowerCase());
  if (idx === -1) return res.status(404).json({ error: 'User not found' });
  users.splice(idx, 1);
  saveUsers(users);
  Object.keys(sessions).forEach(t => { if (sessions[t].username.toLowerCase() === target.toLowerCase()) delete sessions[t]; });
  res.json({ ok: true });
});

app.put('/api/users/:username/password', authRequired, (req, res) => {
  const target = req.params.username;
  if (req.user.role !== 'admin' && req.user.username.toLowerCase() !== target.toLowerCase()) return res.status(403).json({ error: 'Cannot change another user\'s password' });
  const { password } = req.body;
  if (!password || password.length < 4) return res.status(400).json({ error: 'Password must be at least 4 characters' });
  const user = users.find(u => u.username.toLowerCase() === target.toLowerCase());
  if (!user) return res.status(404).json({ error: 'User not found' });
  const { hash, salt } = hashPassword(password);
  user.passwordHash = hash;
  user.salt = salt;
  saveUsers(users);
  res.json({ ok: true });
});

app.put('/api/users/:username/role', authRequired, adminRequired, (req, res) => {
  const target = req.params.username;
  if (target.toLowerCase() === req.user.username.toLowerCase()) return res.status(400).json({ error: 'Cannot change your own role' });
  const { role, allowedSites } = req.body;
  const validRoles = ['superadmin', 'admin', 'user'];
  if (!validRoles.includes(role)) return res.status(400).json({ error: 'Role must be superadmin, admin, or user' });
  // Only superadmin can assign superadmin role
  if (role === 'superadmin' && req.user.role !== 'superadmin') return res.status(403).json({ error: 'Only Super Admin can assign superadmin role' });
  const user = users.find(u => u.username.toLowerCase() === target.toLowerCase());
  if (!user) return res.status(404).json({ error: 'User not found' });
  user.role = role;
  if (allowedSites !== undefined) user.allowedSites = allowedSites;
  saveUsers(users);
  Object.values(sessions).forEach(s => { if (s.username.toLowerCase() === target.toLowerCase()) s.role = role; });
  res.json({ ok: true });
});

// Update user's allowed sites
app.put('/api/users/:username/sites', authRequired, superAdminRequired, (req, res) => {
  const target = req.params.username;
  const { allowedSites } = req.body;
  const user = users.find(u => u.username.toLowerCase() === target.toLowerCase());
  if (!user) return res.status(404).json({ error: 'User not found' });
  user.allowedSites = allowedSites || [];
  saveUsers(users);
  res.json({ ok: true });
});

// ========== MULTI-SITE STATE MANAGEMENT ==========
const SITES_FILE = path.join(DATA_DIR, 'sites.json');

function emptySection(label) {
  return { label, weights: [], infoCols: [], taskCols: [], rows: [], originalHeaders: [] };
}

function getDefaultState() {
  return {
    initials: [],
    sections: {
      PIPE: emptySection('PIPE'),
      PV: emptySection('PV'),
      PSV: emptySection('PSV')
    },
    activeSection: 'PIPE',
    billing: { po: 0, rate: 0, timesheet: [] },
    page: 0,
    pageSize: 100
  };
}

function loadSites() {
  try {
    if (fs.existsSync(SITES_FILE)) return JSON.parse(fs.readFileSync(SITES_FILE, 'utf8'));
  } catch (e) { console.error('Error loading sites:', e.message); }
  return null;
}

function saveSites(sites) {
  fs.writeFileSync(SITES_FILE, JSON.stringify(sites, null, 2), 'utf8');
}

function getSiteStateFile(siteId) {
  return path.join(DATA_DIR, 'state-' + siteId + '.json');
}

function loadSiteState(siteId) {
  const file = getSiteStateFile(siteId);
  try {
    if (fs.existsSync(file)) {
      let s = JSON.parse(fs.readFileSync(file, 'utf8'));
      if (s.rows && !s.sections) {
        const migrated = getDefaultState();
        migrated.initials = s.initials || [];
        migrated.sections.PIPE = {
          label: 'PIPE', weights: s.weights || [], infoCols: s.infoCols || [],
          taskCols: s.taskCols || [], rows: s.rows || [], originalHeaders: s.originalHeaders || []
        };
        return migrated;
      }
      return s;
    }
  } catch (e) { console.error('Error loading site state:', siteId, e.message); }
  return getDefaultState();
}

function saveSiteState(siteId, st) {
  fs.writeFileSync(getSiteStateFile(siteId), JSON.stringify(st), 'utf8');
}

// Initialize sites - migrate existing state.json to first site if needed
function initSites() {
  let sites = loadSites();
  if (!sites) {
    // First run or migration: create default site from existing state.json
    const defaultId = 'default';
    sites = [{ id: defaultId, name: 'Default Site' }];
    if (fs.existsSync(STATE_FILE)) {
      // Migrate existing state.json to site-specific file
      const existingData = fs.readFileSync(STATE_FILE, 'utf8');
      fs.writeFileSync(getSiteStateFile(defaultId), existingData, 'utf8');
      console.log('Migrated existing state.json to site: Default Site');
    }
    saveSites(sites);
  }
  return sites;
}

let sites = initSites();
let activeSiteId = sites[0].id;
let state = loadSiteState(activeSiteId);

// Legacy compat wrapper
function saveStateToDisk(st) {
  saveSiteState(activeSiteId, st);
}

function loadState() {
  return loadSiteState(activeSiteId);
}

// ========== SITE CRUD ROUTES ==========
app.get('/api/sites', authRequired, (req, res) => {
  const userRecord = users.find(u => u.username.toLowerCase() === req.user.username.toLowerCase());
  let visibleSites = sites;
  // Admin users can only see their allowed sites
  if (req.user.role === 'admin' && userRecord && userRecord.allowedSites && userRecord.allowedSites.length > 0) {
    visibleSites = sites.filter(s => userRecord.allowedSites.includes(s.id));
  }
  // Users see same sites as their access allows (or all if no restriction)
  if (req.user.role === 'user' && userRecord && userRecord.allowedSites && userRecord.allowedSites.length > 0) {
    visibleSites = sites.filter(s => userRecord.allowedSites.includes(s.id));
  }
  res.json({ sites: visibleSites, activeSiteId });
});

app.post('/api/sites', authRequired, superAdminRequired, (req, res) => {
  const { name } = req.body;
  if (!name || !name.trim()) return res.status(400).json({ error: 'Site name required' });
  const trimmed = name.trim();
  if (sites.find(s => s.name.toLowerCase() === trimmed.toLowerCase())) return res.status(400).json({ error: 'Site already exists' });
  const id = trimmed.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || ('site-' + Date.now());
  const newSite = { id, name: trimmed };
  sites.push(newSite);
  saveSites(sites);
  // Create empty state for new site
  saveSiteState(id, getDefaultState());
  res.json({ ok: true, site: newSite });
});

app.delete('/api/sites/:id', authRequired, superAdminRequired, (req, res) => {
  const id = req.params.id;
  if (sites.length <= 1) return res.status(400).json({ error: 'Cannot delete the last site' });
  const idx = sites.findIndex(s => s.id === id);
  if (idx === -1) return res.status(404).json({ error: 'Site not found' });
  sites.splice(idx, 1);
  saveSites(sites);
  // Remove state file
  const file = getSiteStateFile(id);
  if (fs.existsSync(file)) fs.unlinkSync(file);
  // Switch active site if needed
  if (activeSiteId === id) {
    activeSiteId = sites[0].id;
    state = loadSiteState(activeSiteId);
  }
  res.json({ ok: true });
});

app.post('/api/sites/:id/switch', authRequired, (req, res) => {
  const id = req.params.id;
  const site = sites.find(s => s.id === id);
  if (!site) return res.status(404).json({ error: 'Site not found' });
  activeSiteId = id;
  state = loadSiteState(id);
  res.json({ ok: true, state });
});

app.put('/api/sites/:id', authRequired, superAdminRequired, (req, res) => {
  const id = req.params.id;
  const { name } = req.body;
  if (!name || !name.trim()) return res.status(400).json({ error: 'Site name required' });
  const site = sites.find(s => s.id === id);
  if (!site) return res.status(404).json({ error: 'Site not found' });
  site.name = name.trim();
  saveSites(sites);
  res.json({ ok: true, site });
});

// Helper to get a section or 404
function getSection(name) {
  return state.sections[name] || null;
}

// ========== EXCEL PARSING HELPERS ==========
function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 6); }

function parseWeightWorkbook(wb) {
  const ws = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(ws, { header: 1, raw: false, defval: '' });
  const weights = [];
  const norm = s => (s || '').toLowerCase().replace(/[^a-z0-9]/g, '');

  // Find header row and column indices dynamically
  let headerRowIdx = -1, taskIdx = -1, tColIdx = -1, weightIdx = -1, minsIdx = -1;
  const taskLabels = ['task', 'taskname', 'task_name', 'activity'];
  const tColLabels = ['tracker_dimension_column', 'trackerdimensioncolumn', 'trackercolumn', 'tracker_column', 'trackercol', 'column', 'dimension'];
  const weightLabels = ['weight', 'weight%', 'weightpercentage', 'weightpercent', 'wt', 'wt%'];
  const minsLabels = ['minutes', 'mins', 'hours', 'hrs', 'time', 'totalminutes', 'totalhours'];

  for (let ri = 0; ri < Math.min(15, rows.length); ri++) {
    const vals = rows[ri] || [];
    for (let ci = 0; ci < vals.length; ci++) {
      const n = norm(String(vals[ci]));
      if (!n) continue;
      if (taskLabels.includes(n) && taskIdx === -1) { taskIdx = ci; headerRowIdx = ri; }
      if (tColLabels.includes(n) && tColIdx === -1) { tColIdx = ci; headerRowIdx = ri; }
      if (weightLabels.includes(n) && weightIdx === -1) { weightIdx = ci; headerRowIdx = ri; }
      if (minsLabels.includes(n) && minsIdx === -1) { minsIdx = ci; headerRowIdx = ri; }
    }
    if (taskIdx !== -1 && tColIdx !== -1) break;
  }

  // If header detection found columns, use index-based parsing
  if (headerRowIdx >= 0 && taskIdx >= 0 && tColIdx >= 0) {
    console.log(`Weight parse: header at row ${headerRowIdx}, task=${taskIdx}, tCol=${tColIdx}, weight=${weightIdx}, mins=${minsIdx}`);
    for (let ri = headerRowIdx + 1; ri < rows.length; ri++) {
      const vals = rows[ri] || [];
      const task = String(vals[taskIdx] || '').trim();
      const tCol = String(vals[tColIdx] || '').trim();
      if (!task || !tCol) continue;
      if (task.toLowerCase() === 'task' || tCol.toLowerCase() === 'tracker_dimension_column') continue;
      const w = weightIdx >= 0 ? parseFloat(vals[weightIdx]) || 0 : 0;
      const m = minsIdx >= 0 ? parseFloat(vals[minsIdx]) || 0 : 0;
      weights.push({ task, trackerCol: tCol, weight: w, minutes: m });
    }
  } else {
    // Fallback: positional parsing (scan each row for string+string+number+number pattern)
    console.log('Weight parse: no header detected, using fallback positional parsing');
    rows.forEach(r => {
      const vals = Object.values(r);
      let task = null, tCol = null, w = null, m = null;
      for (let i = 0; i < vals.length; i++) {
        const v = vals[i];
        if (v && typeof v === 'string' && v.trim() && !task) { task = v.trim(); continue; }
        if (v && typeof v === 'string' && v.trim() && task && !tCol) { tCol = v.trim(); continue; }
        if (task && tCol && w === null && (typeof v === 'number' || !isNaN(parseFloat(v)))) { w = parseFloat(v) || 0; continue; }
        if (task && tCol && w !== null && m === null && (typeof v === 'number' || !isNaN(parseFloat(v)))) { m = parseFloat(v) || 0; break; }
      }
      if (task && tCol && task.toLowerCase() !== 'task' && tCol.toLowerCase() !== 'tracker_dimension_column')
        weights.push({ task, trackerCol: tCol, weight: w || 0, minutes: m || 0 });
    });
  }
  console.log(`Weight parse: found ${weights.length} entries`);
  if (weights.length > 0) console.log('Weight parse sample:', JSON.stringify(weights[0]));
  return weights;
}

function parseInitialsWorkbook(wb) {
  const ws = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(ws, { header: 1, raw: false, defval: '' });
  const initials = [];
  rows.forEach(r => {
    const vals = Object.values(r);
    const ini = String(vals[0] || '').trim().toUpperCase();
    const name = String(vals[1] || '').trim();
    if (ini) initials.push({ initial: ini, name: name || ini });
  });
  return initials;
}

function parseTrackerWorkbook(wb) {
  let sheetName = wb.SheetNames.find(s => s.trim() === 'TRACKER') || wb.SheetNames[0];
  const ws = wb.Sheets[sheetName];
  const raw = XLSX.utils.sheet_to_json(ws, { header: 1, raw: false, defval: '' });
  let headerIdx = 4, maxCols = 0;
  for (let i = 0; i < Math.min(10, raw.length); i++) {
    const filled = raw[i] ? raw[i].filter(c => c && String(c).trim()).length : 0;
    if (filled > maxCols) { maxCols = filled; headerIdx = i; }
  }
  const headers = raw[headerIdx].map(h => String(h || '').trim());
  const taskCols = [], infoCols = [];
  const datePattern = /-DATE$/i;
  const usedIdx = new Set();
  headers.forEach((h, i) => {
    if (datePattern.test(h)) {
      const baseName = h.replace(/-DATE$/i, '');
      let initIdx = -1;
      if (i + 1 < headers.length) {
        const next = headers[i + 1];
        if (next && (next.toLowerCase().includes('initial') || next.replace(/[-\s]*(initial|INITIAL)$/i, '').trim() === baseName)) initIdx = i + 1;
      }
      if (initIdx === -1) {
        for (let j = Math.max(0, i - 2); j < Math.min(headers.length, i + 3); j++) {
          if (j !== i && headers[j] && headers[j].toLowerCase().includes('initial') && headers[j].includes(baseName.split('/')[0])) { initIdx = j; break; }
        }
      }
      taskCols.push({ task: baseName, dateCol: i, initCol: initIdx >= 0 ? initIdx : null, dateHeader: h, initHeader: initIdx >= 0 ? headers[initIdx] : null });
      usedIdx.add(i);
      if (initIdx >= 0) usedIdx.add(initIdx);
    }
  });
  headers.forEach((h, i) => {
    if (!usedIdx.has(i) && h && !h.toLowerCase().includes('initial')) infoCols.push({ name: h, idx: i });
  });
  const finalInfoCols = infoCols.length > 15 ? infoCols.slice(0, 15) : infoCols;
  const rows = [];
  for (let i = headerIdx + 1; i < raw.length; i++) {
    const r = raw[i]; if (!r || !r.length) continue;
    const row = { _id: uid(), _info: {}, _tasks: {} };
    finalInfoCols.forEach(c => { row._info[c.name] = String(r[c.idx] || '').trim(); });
    taskCols.forEach(tc => {
      row._tasks[tc.task] = { date: String(r[tc.dateCol] || '').trim(), initial: tc.initCol !== null ? String(r[tc.initCol] || '').trim() : '' };
    });
    rows.push(row);
  }
  return { taskCols, infoCols: finalInfoCols, rows, originalHeaders: headers };
}

// ========== AUTO-IMPORT ==========
function autoImportFromTrackerFolder() {
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
    saveStateToDisk(state);
    console.log('Auto-import complete.');
  } catch (e) { console.error('Auto-import error:', e.message); }
}

// ========== SECTION CRUD ROUTES ==========
app.get('/api/sections', authRequired, (req, res) => {
  res.json(Object.keys(state.sections));
});

app.post('/api/sections', authRequired, adminRequired, (req, res) => {
  const { name } = req.body;
  if (!name || !name.trim()) return res.status(400).json({ error: 'Section name required' });
  const key = name.trim().toUpperCase();
  if (state.sections[key]) return res.status(400).json({ error: 'Section already exists' });
  state.sections[key] = emptySection(key);
  saveStateToDisk(state);
  res.json({ ok: true, name: key });
});

app.delete('/api/sections/:name', authRequired, adminRequired, (req, res) => {
  const key = req.params.name.toUpperCase();
  if (!state.sections[key]) return res.status(404).json({ error: 'Section not found' });
  if (Object.keys(state.sections).length <= 1) return res.status(400).json({ error: 'Cannot delete the last section' });
  delete state.sections[key];
  if (state.activeSection === key) state.activeSection = Object.keys(state.sections)[0];
  saveStateToDisk(state);
  res.json({ ok: true });
});

app.post('/api/sections/:name/duplicate', authRequired, adminRequired, (req, res) => {
  const sourceKey = req.params.name.toUpperCase();
  const { newName } = req.body;
  if (!newName || !newName.trim()) return res.status(400).json({ error: 'New section name required' });
  const targetKey = newName.trim().toUpperCase();
  if (state.sections[targetKey]) return res.status(400).json({ error: 'Section already exists' });
  const source = state.sections[sourceKey];
  if (!source) return res.status(404).json({ error: 'Source section not found' });
  // Copy structure (weights, taskCols, infoCols) but empty rows
  state.sections[targetKey] = {
    label: targetKey,
    weights: JSON.parse(JSON.stringify(source.weights)),
    infoCols: JSON.parse(JSON.stringify(source.infoCols)),
    taskCols: JSON.parse(JSON.stringify(source.taskCols)),
    rows: [],
    originalHeaders: JSON.parse(JSON.stringify(source.originalHeaders))
  };
  saveStateToDisk(state);
  res.json({ ok: true, name: targetKey });
});

// ========== STATE ROUTES ==========
app.get('/api/state', authRequired, (req, res) => {
  res.json(state);
});

app.post('/api/state', authRequired, (req, res) => {
  state = req.body;
  saveStateToDisk(state);
  res.json({ ok: true });
});

// ========== SECTION-AWARE UPLOAD ROUTES ==========
app.post('/api/upload/:section/weight', authRequired, adminRequired, upload.single('file'), (req, res) => {
  const key = req.params.section.toUpperCase();
  const sec = state.sections[key];
  if (!sec) return res.status(404).json({ error: 'Section not found' });
  try {
    const wb = XLSX.readFile(req.file.path);
    sec.weights = parseWeightWorkbook(wb);
    saveStateToDisk(state);
    fs.unlinkSync(req.file.path);
    res.json({ ok: true, count: sec.weights.length, weights: sec.weights });
  } catch (e) { res.status(400).json({ error: e.message }); }
});

// Global initials upload (shared across sections)
app.post('/api/upload/initials', authRequired, adminRequired, upload.single('file'), (req, res) => {
  try {
    const wb = XLSX.readFile(req.file.path);
    state.initials = parseInitialsWorkbook(wb);
    saveStateToDisk(state);
    fs.unlinkSync(req.file.path);
    res.json({ ok: true, count: state.initials.length, initials: state.initials });
  } catch (e) { res.status(400).json({ error: e.message }); }
});

app.post('/api/upload/:section/tracker', authRequired, adminRequired, upload.single('file'), (req, res) => {
  const key = req.params.section.toUpperCase();
  const sec = state.sections[key];
  if (!sec) return res.status(404).json({ error: 'Section not found' });
  try {
    const wb = XLSX.readFile(req.file.path);
    const result = parseTrackerWorkbook(wb);
    sec.taskCols = result.taskCols;
    sec.infoCols = result.infoCols;
    sec.rows = result.rows;
    sec.originalHeaders = result.originalHeaders;
    state.page = 0;
    saveStateToDisk(state);
    fs.unlinkSync(req.file.path);
    res.json({ ok: true, rows: sec.rows.length, taskCols: sec.taskCols.length, infoCols: sec.infoCols.length });
  } catch (e) { res.status(400).json({ error: e.message }); }
});

// ========== SECTION-AWARE EXPORT ROUTES ==========
app.get('/api/export/:section/tracker.xlsx', authRequired, (req, res) => {
  const key = req.params.section.toUpperCase();
  const sec = state.sections[key];
  if (!sec) return res.status(404).json({ error: 'Section not found' });
  const headers = [];
  sec.infoCols.forEach(c => headers.push(c.name));
  sec.taskCols.forEach(tc => { headers.push(tc.dateHeader || tc.task + '-DATE'); headers.push(tc.initHeader || tc.task + '- INITIAL'); });
  const data = [headers];
  sec.rows.forEach(r => {
    const row = [];
    sec.infoCols.forEach(c => row.push(r._info[c.name] || ''));
    sec.taskCols.forEach(tc => { const t = r._tasks[tc.task] || { date: '', initial: '' }; row.push(t.date); row.push(t.initial); });
    data.push(row);
  });
  const ws = XLSX.utils.aoa_to_sheet(data);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'TRACKER');
  const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
  res.setHeader('Content-Disposition', `attachment; filename="${key}-tracker-export.xlsx"`);
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.send(buf);
});

app.get('/api/export/:section/tracker.csv', authRequired, (req, res) => {
  const key = req.params.section.toUpperCase();
  const sec = state.sections[key];
  if (!sec) return res.status(404).json({ error: 'Section not found' });
  const headers = [];
  sec.infoCols.forEach(c => headers.push(c.name));
  sec.taskCols.forEach(tc => { headers.push(tc.task + '-DATE'); headers.push(tc.task + '-INITIAL'); });
  const rows = [headers];
  sec.rows.forEach(r => {
    const row = [];
    sec.infoCols.forEach(c => row.push(r._info[c.name] || ''));
    sec.taskCols.forEach(tc => { const t = r._tasks[tc.task] || {}; row.push(t.date || ''); row.push(t.initial || ''); });
    rows.push(row);
  });
  const csv = rows.map(r => r.map(c => `"${String(c || '').replace(/"/g, '""')}"`).join(',')).join('\n');
  res.setHeader('Content-Disposition', `attachment; filename="${key}-tracker-export.csv"`);
  res.setHeader('Content-Type', 'text/csv');
  res.send(csv);
});

app.get('/api/export/kpi.csv', authRequired, (req, res) => {
  const sectionFilter = req.query.section ? req.query.section.toUpperCase() : null;
  const sectionsToProcess = sectionFilter ? { [sectionFilter]: state.sections[sectionFilter] } : state.sections;

  function getWeightFor(taskName, sec) {
    const norm = s => (s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
    const tn = norm(taskName);
    return sec.weights.find(w => {
      const base = w.trackerCol.replace(/-DATE$/i, '').trim();
      const nb = norm(base);
      const nt = norm(w.task);
      return base === taskName || w.task === taskName || nb === tn || nt === tn
        || tn.includes(nb) || nb.includes(tn)
        || tn.includes(nt) || nt.includes(tn);
    });
  }

  const rows = [['Initials', 'Name', 'Tasks Done', 'Weighted Score', 'Minutes', 'Circuits Touched']];
  state.initials.forEach(p => {
    let tasks = 0, ws = 0, mins = 0, circs = new Set();
    Object.values(sectionsToProcess).forEach(sec => {
      if (!sec) return;
      sec.rows.forEach(r => {
        sec.taskCols.forEach(tc => {
          const t = r._tasks[tc.task];
          if (t && t.initial && t.initial.toUpperCase() === p.initial.toUpperCase() && t.date) {
            tasks++; const w = getWeightFor(tc.task, sec); ws += w ? w.weight : 0; mins += w ? w.minutes : 0;
            circs.add(Object.values(r._info).join('|'));
          }
        });
      });
    });
    if (tasks) rows.push([p.initial, p.name, tasks, ws.toFixed(1), mins.toFixed(1), circs.size]);
  });

  const csv = rows.map(r => r.map(c => `"${String(c || '').replace(/"/g, '""')}"`).join(',')).join('\n');
  res.setHeader('Content-Disposition', 'attachment; filename="kpi-report.csv"');
  res.setHeader('Content-Type', 'text/csv');
  res.send(csv);
});

app.get('/api/export/backup.json', authRequired, (req, res) => {
  res.setHeader('Content-Disposition', 'attachment; filename="tracker-backup.json"');
  res.json(state);
});

app.post('/api/import/backup', authRequired, adminRequired, upload.single('file'), (req, res) => {
  try {
    const data = fs.readFileSync(req.file.path, 'utf8');
    state = JSON.parse(data);
    saveStateToDisk(state);
    fs.unlinkSync(req.file.path);
    res.json({ ok: true });
  } catch (e) { res.status(400).json({ error: 'Invalid JSON file' }); }
});

// ========== START ==========
autoImportFromTrackerFolder();

app.listen(PORT, () => {
  console.log(`Task Tracker running at http://localhost:${PORT}`);
});
