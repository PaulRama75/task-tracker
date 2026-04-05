require('dotenv').config();
const express = require('express');
const multer = require('multer');
const XLSX = require('xlsx');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const db = require('./db');

// Security packages
let helmet, rateLimit, bcrypt;
try { helmet = require('helmet'); } catch (e) { helmet = null; }
try { rateLimit = require('express-rate-limit'); } catch (e) { rateLimit = null; }
try { bcrypt = require('bcrypt'); } catch (e) { bcrypt = null; }

const app = express();
const PORT = process.env.PORT || 3002;
const SESSION_TIMEOUT = 30 * 60 * 1000; // 30 minutes idle timeout
const MAX_LOGIN_ATTEMPTS = 5;
const LOCKOUT_DURATION = 15 * 60 * 1000; // 15 minutes
const loginAttempts = {}; // Track failed login attempts per IP/username

// Directories
const DATA_DIR = path.join(__dirname, 'data');
const UPLOAD_DIR = path.join(__dirname, 'uploads');
const TRACKER_DIR = 'C:/Users/Ramii/OneDrive - fixedequipmentreliability.com/Documents/Tracker';

[DATA_DIR, UPLOAD_DIR].forEach(d => { if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true }); });

const upload = multer({ dest: UPLOAD_DIR });

// ========== SECURITY MIDDLEWARE ==========
app.set('trust proxy', 1);
app.disable('x-powered-by');

if (helmet) {
  app.use(helmet({
    contentSecurityPolicy: false, // Handled by Nginx
    hsts: false // Handled by Nginx
  }));
}

// Rate limiting
if (rateLimit) {
  const globalLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 200,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Too many requests, please try again later.' }
  });
  app.use('/api/', globalLimiter);

  const loginLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 10,
    skipSuccessfulRequests: true,
    message: { error: 'Too many login attempts. Try again in 15 minutes.' }
  });
  app.use('/api/login', loginLimiter);
}

app.use(express.json({ limit: '50mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// ========== AUTH SYSTEM ==========
const sessions = {};
let users = []; // Loaded from DB on startup

// Password hashing: use bcrypt if available, fallback to sha256
function hashPassword(password, salt) {
  if (!salt) salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.createHash('sha256').update(salt + password).digest('hex');
  return { hash, salt };
}

async function hashPasswordSecure(password) {
  if (bcrypt) {
    const hash = await bcrypt.hash(password, 12);
    return { hash, salt: 'bcrypt' };
  }
  return hashPassword(password);
}

function verifyPassword(password, storedHash, salt) {
  if (salt === 'bcrypt' && bcrypt) {
    return bcrypt.compareSync(password, storedHash);
  }
  const { hash } = hashPassword(password, salt);
  return hash === storedHash;
}

// Brute force protection
function checkBruteForce(key) {
  const record = loginAttempts[key];
  if (!record) return { locked: false };
  if (record.lockedUntil && Date.now() < record.lockedUntil) {
    return { locked: true, remaining: Math.ceil((record.lockedUntil - Date.now()) / 1000) };
  }
  if (record.lockedUntil && Date.now() >= record.lockedUntil) {
    delete loginAttempts[key];
    return { locked: false };
  }
  return { locked: false, attempts: record.count };
}

function recordFailedLogin(key) {
  if (!loginAttempts[key]) loginAttempts[key] = { count: 0 };
  loginAttempts[key].count++;
  if (loginAttempts[key].count >= MAX_LOGIN_ATTEMPTS) {
    loginAttempts[key].lockedUntil = Date.now() + LOCKOUT_DURATION;
  }
}

function clearFailedLogin(key) {
  delete loginAttempts[key];
}

function generateToken() { return crypto.randomBytes(32).toString('hex'); }

function authRequired(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) return res.status(401).json({ error: 'Authentication required' });
  const token = authHeader.slice(7);
  const session = sessions[token];
  if (!session) return res.status(401).json({ error: 'Invalid or expired session' });
  // Session timeout check
  if (Date.now() - (session.lastActivity || session.created) > SESSION_TIMEOUT) {
    delete sessions[token];
    return res.status(401).json({ error: 'Session expired due to inactivity. Please login again.' });
  }
  session.lastActivity = Date.now();
  req.user = session;
  next();
}

// Clean up expired sessions periodically (every 5 minutes)
setInterval(() => {
  const now = Date.now();
  Object.keys(sessions).forEach(token => {
    const s = sessions[token];
    if (now - (s.lastActivity || s.created) > SESSION_TIMEOUT) {
      delete sessions[token];
    }
  });
}, 5 * 60 * 1000);

function adminRequired(req, res, next) {
  if (req.user.role !== 'admin' && req.user.role !== 'superadmin') return res.status(403).json({ error: 'Admin access required' });
  next();
}

function superAdminRequired(req, res, next) {
  if (req.user.role !== 'superadmin') return res.status(403).json({ error: 'Super Admin access required' });
  next();
}

function siteAccessRequired(req, res, next) {
  if (req.user.role === 'superadmin') return next();
  const userRecord = users.find(u => u.username.toLowerCase() === req.user.username.toLowerCase());
  if (!userRecord) return res.status(403).json({ error: 'User not found' });
  const allowedSites = userRecord.allowedSites || [];
  // If user has assigned sites, check current site is in the list
  if (allowedSites.length > 0 && !allowedSites.includes(activeSiteId)) {
    return res.status(403).json({ error: 'No access to this site' });
  }
  // If user has no sites assigned at all, block access
  if (allowedSites.length === 0) {
    return res.status(403).json({ error: 'No sites assigned to your account' });
  }
  next();
}

// ========== AUTH ROUTES ==========
app.post('/api/login', async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) return res.status(400).json({ error: 'Username and password required' });

  // Brute force check by IP and username
  const clientIP = req.ip || req.connection.remoteAddress;
  const bruteKey = `${clientIP}:${username.toLowerCase()}`;
  const bruteCheck = checkBruteForce(bruteKey);
  if (bruteCheck.locked) {
    return res.status(429).json({ error: `Account temporarily locked. Try again in ${bruteCheck.remaining} seconds.` });
  }

  const user = users.find(u => u.username.toLowerCase() === username.toLowerCase());
  if (!user || !verifyPassword(password, user.passwordHash, user.salt)) {
    recordFailedLogin(bruteKey);
    return res.status(401).json({ error: 'Invalid username or password' });
  }

  clearFailedLogin(bruteKey);

  // Re-hash with bcrypt if still using sha256
  if (user.salt !== 'bcrypt' && bcrypt) {
    try {
      const { hash, salt } = await hashPasswordSecure(password);
      await db.updateUser(user.username, { passwordHash: hash, salt });
      user.passwordHash = hash;
      user.salt = salt;
      console.log(`Upgraded password hash for ${user.username} to bcrypt`);
    } catch (e) { console.error('bcrypt upgrade failed:', e.message); }
  }

  const token = generateToken();
  sessions[token] = { username: user.username, role: user.role, created: Date.now(), lastActivity: Date.now() };
  res.json({ ok: true, token, username: user.username, role: user.role, allowedSites: user.allowedSites || [], allowedApps: user.allowedApps || [] });
});

app.post('/api/logout', (req, res) => {
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) delete sessions[authHeader.slice(7)];
  res.json({ ok: true });
});

app.get('/api/me', authRequired, (req, res) => {
  const userRecord = users.find(u => u.username.toLowerCase() === req.user.username.toLowerCase());
  res.json({ username: req.user.username, role: req.user.role, allowedSites: userRecord ? userRecord.allowedSites || [] : [], allowedApps: userRecord ? userRecord.allowedApps || [] : [] });
});

// User management
app.get('/api/users', authRequired, adminRequired, (req, res) => {
  res.json(users.map(u => ({ username: u.username, role: u.role, allowedSites: u.allowedSites || [], allowedApps: u.allowedApps || [] })));
});

app.post('/api/users', authRequired, adminRequired, async (req, res) => {
  const { username, password, role, allowedSites, allowedApps } = req.body;
  if (!username || !password) return res.status(400).json({ error: 'Username and password required' });
  const validRoles = ['superadmin', 'admin', 'user'];
  if (!validRoles.includes(role)) return res.status(400).json({ error: 'Role must be superadmin, admin, or user' });
  if ((role === 'superadmin' || role === 'admin') && req.user.role !== 'superadmin') return res.status(403).json({ error: 'Only Super Admin can create admin/superadmin users' });
  if (users.find(u => u.username.toLowerCase() === username.toLowerCase())) return res.status(400).json({ error: 'Username already exists' });
  const { hash, salt } = await hashPasswordSecure(password);
  try {
    await db.createUser(username, hash, salt, role, allowedSites || [], allowedApps || []);
    users.push({ username, passwordHash: hash, salt, role, allowedSites: allowedSites || [], allowedApps: allowedApps || [] });
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.delete('/api/users/:username', authRequired, superAdminRequired, async (req, res) => {
  const target = req.params.username;
  if (target.toLowerCase() === req.user.username.toLowerCase()) return res.status(400).json({ error: 'Cannot delete your own account' });
  const idx = users.findIndex(u => u.username.toLowerCase() === target.toLowerCase());
  if (idx === -1) return res.status(404).json({ error: 'User not found' });
  try {
    await db.deleteUser(target);
    users.splice(idx, 1);
    Object.keys(sessions).forEach(t => { if (sessions[t].username.toLowerCase() === target.toLowerCase()) delete sessions[t]; });
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.put('/api/users/:username/password', authRequired, async (req, res) => {
  const target = req.params.username;
  if (req.user.role !== 'admin' && req.user.role !== 'superadmin' && req.user.username.toLowerCase() !== target.toLowerCase()) return res.status(403).json({ error: 'Cannot change another user\'s password' });
  const { password } = req.body;
  if (!password || password.length < 6) return res.status(400).json({ error: 'Password must be at least 6 characters' });
  const user = users.find(u => u.username.toLowerCase() === target.toLowerCase());
  if (!user) return res.status(404).json({ error: 'User not found' });
  const { hash, salt } = await hashPasswordSecure(password);
  try {
    await db.updateUser(target, { passwordHash: hash, salt });
    user.passwordHash = hash;
    user.salt = salt;
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.put('/api/users/:username/role', authRequired, adminRequired, async (req, res) => {
  const target = req.params.username;
  if (target.toLowerCase() === req.user.username.toLowerCase()) return res.status(400).json({ error: 'Cannot change your own role' });
  const { role, allowedSites } = req.body;
  const validRoles = ['superadmin', 'admin', 'user'];
  if (!validRoles.includes(role)) return res.status(400).json({ error: 'Role must be superadmin, admin, or user' });
  if (role === 'superadmin' && req.user.role !== 'superadmin') return res.status(403).json({ error: 'Only Super Admin can assign superadmin role' });
  const user = users.find(u => u.username.toLowerCase() === target.toLowerCase());
  if (!user) return res.status(404).json({ error: 'User not found' });
  try {
    const updates = { role };
    if (allowedSites !== undefined) updates.allowedSites = allowedSites;
    await db.updateUser(target, updates);
    user.role = role;
    if (allowedSites !== undefined) user.allowedSites = allowedSites;
    Object.values(sessions).forEach(s => { if (s.username.toLowerCase() === target.toLowerCase()) s.role = role; });
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.put('/api/users/:username/sites', authRequired, superAdminRequired, async (req, res) => {
  const target = req.params.username;
  const { allowedSites } = req.body;
  const user = users.find(u => u.username.toLowerCase() === target.toLowerCase());
  if (!user) return res.status(404).json({ error: 'User not found' });
  try {
    await db.updateUser(target, { allowedSites: allowedSites || [] });
    user.allowedSites = allowedSites || [];
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.put('/api/users/:username/access', authRequired, superAdminRequired, async (req, res) => {
  const target = req.params.username;
  const { allowedSites, allowedApps } = req.body;
  const user = users.find(u => u.username.toLowerCase() === target.toLowerCase());
  if (!user) return res.status(404).json({ error: 'User not found' });
  try {
    const updates = {};
    if (allowedSites !== undefined) updates.allowedSites = allowedSites;
    if (allowedApps !== undefined) updates.allowedApps = allowedApps;
    await db.updateUser(target, updates);
    if (allowedSites !== undefined) user.allowedSites = allowedSites;
    if (allowedApps !== undefined) user.allowedApps = allowedApps;
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ========== APP MODULE ROUTES ==========
app.get('/api/apps', authRequired, async (req, res) => {
  try {
    const apps = await db.getApps();
    // Superadmin sees all apps
    if (req.user.role === 'superadmin') return res.json({ apps });
    // Admins see all except hide nothing — but Users app only for admin+
    // Regular users: only built-in apps (except Users) + their assigned apps
    const userRecord = users.find(u => u.username.toLowerCase() === req.user.username.toLowerCase());
    const allowedApps = userRecord ? (userRecord.allowedApps || []) : [];
    const isAdmin = req.user.role === 'admin';
    const filtered = apps.filter(a => {
      // Users app: only admin and superadmin
      if (a.name.toLowerCase() === 'users') return isAdmin;
      // Built-in apps: always visible
      if (a.isBuiltin) return true;
      // Assigned apps
      return allowedApps.includes(a.id);
    });
    res.json({ apps: filtered });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/apps', authRequired, superAdminRequired, async (req, res) => {
  const { name, icon } = req.body;
  if (!name || !name.trim()) return res.status(400).json({ error: 'App name required' });
  try {
    const app = await db.createApp(name.trim(), icon || 'folder');
    res.json({ ok: true, app });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.put('/api/apps/:id', authRequired, superAdminRequired, async (req, res) => {
  const id = parseInt(req.params.id);
  const { name, icon, sortOrder } = req.body;
  try {
    await db.updateApp(id, { name, icon, sortOrder });
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.delete('/api/apps/:id', authRequired, superAdminRequired, async (req, res) => {
  const id = parseInt(req.params.id);
  try {
    await db.deleteApp(id);
    res.json({ ok: true });
  } catch (e) { res.status(400).json({ error: e.message }); }
});

// Switch active app - loads that app's sites and state
app.post('/api/apps/:id/switch', authRequired, async (req, res) => {
  const appId = parseInt(req.params.id);
  try {
    // Check access: non-superadmin must have this app assigned or it must be built-in
    if (req.user.role !== 'superadmin') {
      const allApps = await db.getApps();
      const targetApp = allApps.find(a => a.id === appId);
      if (!targetApp) return res.status(404).json({ error: 'App not found' });
      if (!targetApp.isBuiltin) {
        const userRecord = users.find(u => u.username.toLowerCase() === req.user.username.toLowerCase());
        const allowedApps = userRecord ? (userRecord.allowedApps || []) : [];
        if (!allowedApps.includes(appId)) return res.status(403).json({ error: 'No access to this application' });
      }
    }
    // Load sites for this app
    activeAppId = appId;
    sites = await db.getSites(appId);

    // Only create default site for Task Tracker app (not Safety, Users, or placeholder apps)
    if (!sites.length) {
      const allApps = await db.getApps();
      const targetApp = allApps.find(a => a.id === appId);
      if (targetApp && targetApp.name.toLowerCase() === 'task tracker') {
        const defaultId = 'default-app' + appId;
        await db.createSite(defaultId, 'Default Site', appId);
        sites = await db.getSites(appId);
        console.log(`Created default site for app ${appId}`);
      }
    }

    // Filter sites by user access for non-superadmin
    let userSites = sites;
    if (req.user.role !== 'superadmin') {
      const userRecord = users.find(u => u.username.toLowerCase() === req.user.username.toLowerCase());
      const allowedSites = userRecord ? (userRecord.allowedSites || []) : [];
      if (allowedSites.length > 0) {
        userSites = sites.filter(s => allowedSites.includes(s.id));
      } else {
        userSites = [];
      }
    }

    // Load first accessible site's state
    if (userSites.length > 0) {
      activeSiteId = userSites[0].id;
      state = await db.loadSiteState(activeSiteId);
    }

    res.json({ ok: true, sites: userSites, activeSiteId: userSites.length > 0 ? userSites[0].id : '', state: userSites.length > 0 ? state : null });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ========== MULTI-SITE STATE MANAGEMENT ==========
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

let sites = [];
let activeSiteId = '';
let activeAppId = 1;
let state = getDefaultState();

// Save state to DB (replaces JSON file save)
async function saveStateToDisk(st) {
  try {
    await db.saveSiteState(activeSiteId, st);
  } catch (e) {
    console.error('Error saving state to DB:', e.message);
  }
}

// ========== SITE CRUD ROUTES ==========
app.get('/api/sites', authRequired, (req, res) => {
  // Superadmin sees all sites
  if (req.user.role === 'superadmin') {
    return res.json({ sites, activeSiteId, activeAppId });
  }
  // Non-superadmin: filter by allowed sites
  const userRecord = users.find(u => u.username.toLowerCase() === req.user.username.toLowerCase());
  const allowedSites = userRecord ? (userRecord.allowedSites || []) : [];
  if (allowedSites.length > 0) {
    const visibleSites = sites.filter(s => allowedSites.includes(s.id));
    return res.json({ sites: visibleSites, activeSiteId, activeAppId });
  }
  // No sites assigned — show nothing
  res.json({ sites: [], activeSiteId, activeAppId });
});

app.post('/api/sites', authRequired, superAdminRequired, async (req, res) => {
  const { name } = req.body;
  if (!name || !name.trim()) return res.status(400).json({ error: 'Site name required' });
  const trimmed = name.trim();
  if (sites.find(s => s.name.toLowerCase() === trimmed.toLowerCase())) return res.status(400).json({ error: 'Site already exists' });
  const id = trimmed.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') + '-' + activeAppId || ('site-' + Date.now());
  try {
    await db.createSite(id, trimmed, activeAppId);
    const newSite = { id, name: trimmed, app_id: activeAppId };
    sites.push(newSite);
    res.json({ ok: true, site: newSite });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.delete('/api/sites/:id', authRequired, superAdminRequired, async (req, res) => {
  const id = req.params.id;
  if (sites.length <= 1) return res.status(400).json({ error: 'Cannot delete the last site' });
  const idx = sites.findIndex(s => s.id === id);
  if (idx === -1) return res.status(404).json({ error: 'Site not found' });
  try {
    await db.deleteSite(id);
    sites.splice(idx, 1);
    if (activeSiteId === id) {
      activeSiteId = sites[0].id;
      state = await db.loadSiteState(activeSiteId);
    }
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/sites/:id/switch', authRequired, async (req, res) => {
  const id = req.params.id;
  const site = sites.find(s => s.id === id);
  if (!site) return res.status(404).json({ error: 'Site not found' });
  // Check site access for non-superadmin
  if (req.user.role !== 'superadmin') {
    const userRecord = users.find(u => u.username.toLowerCase() === req.user.username.toLowerCase());
    const allowedSites = userRecord ? (userRecord.allowedSites || []) : [];
    if (allowedSites.length > 0 && !allowedSites.includes(id)) {
      return res.status(403).json({ error: 'No access to this site' });
    }
    if (allowedSites.length === 0) {
      return res.status(403).json({ error: 'No sites assigned to your account' });
    }
  }
  try {
    activeSiteId = id;
    state = await db.loadSiteState(id);
    res.json({ ok: true, state });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.put('/api/sites/:id', authRequired, superAdminRequired, async (req, res) => {
  const id = req.params.id;
  const { name } = req.body;
  if (!name || !name.trim()) return res.status(400).json({ error: 'Site name required' });
  const site = sites.find(s => s.id === id);
  if (!site) return res.status(404).json({ error: 'Site not found' });
  try {
    await db.renameSite(id, name.trim());
    site.name = name.trim();
    res.json({ ok: true, site });
  } catch (e) { res.status(500).json({ error: e.message }); }
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

app.post('/api/sections', authRequired, adminRequired, async (req, res) => {
  const { name } = req.body;
  if (!name || !name.trim()) return res.status(400).json({ error: 'Section name required' });
  const key = name.trim().toUpperCase();
  if (state.sections[key]) return res.status(400).json({ error: 'Section already exists' });
  state.sections[key] = emptySection(key);
  await saveStateToDisk(state);
  res.json({ ok: true, name: key });
});

app.delete('/api/sections/:name', authRequired, adminRequired, async (req, res) => {
  const key = req.params.name.toUpperCase();
  if (!state.sections[key]) return res.status(404).json({ error: 'Section not found' });
  if (Object.keys(state.sections).length <= 1) return res.status(400).json({ error: 'Cannot delete the last section' });
  delete state.sections[key];
  if (state.activeSection === key) state.activeSection = Object.keys(state.sections)[0];
  await saveStateToDisk(state);
  res.json({ ok: true });
});

app.post('/api/sections/:name/duplicate', authRequired, adminRequired, async (req, res) => {
  const sourceKey = req.params.name.toUpperCase();
  const { newName } = req.body;
  if (!newName || !newName.trim()) return res.status(400).json({ error: 'New section name required' });
  const targetKey = newName.trim().toUpperCase();
  if (state.sections[targetKey]) return res.status(400).json({ error: 'Section already exists' });
  const source = state.sections[sourceKey];
  if (!source) return res.status(404).json({ error: 'Source section not found' });
  state.sections[targetKey] = {
    label: targetKey,
    weights: JSON.parse(JSON.stringify(source.weights)),
    infoCols: JSON.parse(JSON.stringify(source.infoCols)),
    taskCols: JSON.parse(JSON.stringify(source.taskCols)),
    rows: [],
    originalHeaders: JSON.parse(JSON.stringify(source.originalHeaders))
  };
  await saveStateToDisk(state);
  res.json({ ok: true, name: targetKey });
});

// ========== STATE ROUTES ==========
app.get('/api/state', authRequired, (req, res) => {
  res.json(state);
});

app.post('/api/state', authRequired, async (req, res) => {
  state = req.body;
  await saveStateToDisk(state);
  res.json({ ok: true });
});

// ========== SECTION-AWARE UPLOAD ROUTES ==========
app.post('/api/upload/:section/weight', authRequired, adminRequired, upload.single('file'), async (req, res) => {
  const key = req.params.section.toUpperCase();
  const sec = state.sections[key];
  if (!sec) return res.status(404).json({ error: 'Section not found' });
  try {
    const wb = XLSX.readFile(req.file.path);
    sec.weights = parseWeightWorkbook(wb);
    await saveStateToDisk(state);
    fs.unlinkSync(req.file.path);
    res.json({ ok: true, count: sec.weights.length, weights: sec.weights });
  } catch (e) { res.status(400).json({ error: e.message }); }
});

app.post('/api/upload/initials', authRequired, adminRequired, upload.single('file'), async (req, res) => {
  try {
    const wb = XLSX.readFile(req.file.path);
    state.initials = parseInitialsWorkbook(wb);
    await saveStateToDisk(state);
    fs.unlinkSync(req.file.path);
    res.json({ ok: true, count: state.initials.length, initials: state.initials });
  } catch (e) { res.status(400).json({ error: e.message }); }
});

app.post('/api/upload/:section/tracker', authRequired, adminRequired, upload.single('file'), async (req, res) => {
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
    await saveStateToDisk(state);
    fs.unlinkSync(req.file.path);
    res.json({ ok: true, rows: sec.rows.length, taskCols: sec.taskCols.length, infoCols: sec.infoCols.length });
  } catch (e) { res.status(400).json({ error: e.message }); }
});

// ========== EXPORT ROUTES ==========
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

app.post('/api/import/backup', authRequired, adminRequired, upload.single('file'), async (req, res) => {
  try {
    const data = fs.readFileSync(req.file.path, 'utf8');
    state = JSON.parse(data);
    await saveStateToDisk(state);
    fs.unlinkSync(req.file.path);
    res.json({ ok: true });
  } catch (e) { res.status(400).json({ error: 'Invalid JSON file' }); }
});

// ========== USERS APP ROUTES ==========
// Serve users management page
app.get('/users/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'users', 'index.html'));
});

// Get ALL sites across all apps (for user access assignment)
app.get('/users/api/all-sites', authRequired, adminRequired, async (req, res) => {
  try {
    const allSites = await db.getSites(); // no appId filter = all sites
    res.json(allSites);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Export users to Excel
app.get('/users/api/export', authRequired, adminRequired, async (req, res) => {
  try {
    const allUsers = await db.getUsers();
    const allApps = await db.getApps();
    const allSites = await db.getSites();

    const rows = [['Username', 'Role', 'Allowed Apps', 'Allowed Sites']];
    allUsers.forEach(u => {
      const appNames = (u.allowedApps || []).map(aid => {
        const app = allApps.find(a => a.id === aid);
        return app ? app.name : 'App #' + aid;
      }).join(', ');
      const siteNames = (u.allowedSites || []).map(sid => {
        const site = allSites.find(s => s.id === sid);
        return site ? site.name : sid;
      }).join(', ');
      rows.push([u.username, u.role, appNames, siteNames]);
    });

    const ws = XLSX.utils.aoa_to_sheet(rows);
    // Set column widths
    ws['!cols'] = [{ wch: 20 }, { wch: 15 }, { wch: 30 }, { wch: 40 }];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Users');
    const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
    res.setHeader('Content-Disposition', 'attachment; filename="users-export.xlsx"');
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.send(buf);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Import preview — parse Excel and show what will happen
app.post('/users/api/import-preview', authRequired, superAdminRequired, upload.single('file'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
    const wb = XLSX.readFile(req.file.path);
    const ws = wb.Sheets[wb.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json(ws, { header: 1, raw: false, defval: '' });
    fs.unlinkSync(req.file.path);

    if (rows.length < 2) return res.status(400).json({ error: 'File has no data rows' });

    // Find header row
    const header = rows[0].map(h => String(h || '').toLowerCase().trim());
    const usernameIdx = header.findIndex(h => h.includes('username') || h === 'user');
    const roleIdx = header.findIndex(h => h.includes('role'));
    const passwordIdx = header.findIndex(h => h.includes('password'));
    const appsIdx = header.findIndex(h => h.includes('app'));
    const sitesIdx = header.findIndex(h => h.includes('site'));

    if (usernameIdx === -1) return res.status(400).json({ error: 'Could not find "Username" column in file' });

    const existingUsers = await db.getUsers();
    const parsed = [];

    for (let i = 1; i < rows.length; i++) {
      const r = rows[i];
      const username = String(r[usernameIdx] || '').trim();
      if (!username) continue;

      const role = roleIdx >= 0 ? String(r[roleIdx] || 'user').trim().toLowerCase() : 'user';
      const password = passwordIdx >= 0 ? String(r[passwordIdx] || '').trim() : '';
      const appsStr = appsIdx >= 0 ? String(r[appsIdx] || '').trim() : '';
      const sitesStr = sitesIdx >= 0 ? String(r[sitesIdx] || '').trim() : '';
      const exists = existingUsers.some(u => u.username.toLowerCase() === username.toLowerCase());

      parsed.push({ username, role, password, allowedApps: appsStr, allowedSites: sitesStr, exists });
    }

    res.json({ users: parsed });
  } catch (e) {
    if (req.file && fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
    res.status(500).json({ error: e.message });
  }
});

// Import confirm — create/update users
app.post('/users/api/import', authRequired, superAdminRequired, async (req, res) => {
  try {
    const { users: importUsers } = req.body;
    if (!importUsers || !importUsers.length) return res.status(400).json({ error: 'No users to import' });

    const allApps = await db.getApps();
    const allSites = await db.getSites();
    const existingUsers = await db.getUsers();

    let created = 0, updated = 0, errors = [];

    for (const u of importUsers) {
      const username = String(u.username || '').trim();
      if (!username) continue;

      let role = String(u.role || 'user').trim().toLowerCase();
      if (!['superadmin', 'admin', 'user'].includes(role)) role = 'user';

      // Resolve app names to IDs
      const allowedApps = [];
      if (u.allowedApps) {
        String(u.allowedApps).split(',').forEach(name => {
          const n = name.trim().toLowerCase();
          if (!n) return;
          const app = allApps.find(a => a.name.toLowerCase() === n);
          if (app) allowedApps.push(app.id);
        });
      }

      // Resolve site names to IDs
      const allowedSites = [];
      if (u.allowedSites) {
        String(u.allowedSites).split(',').forEach(name => {
          const n = name.trim().toLowerCase();
          if (!n) return;
          const site = allSites.find(s => s.name.toLowerCase() === n || s.id.toLowerCase() === n);
          if (site) allowedSites.push(site.id);
        });
      }

      const exists = existingUsers.some(eu => eu.username.toLowerCase() === username.toLowerCase());

      if (exists) {
        // Update existing user
        try {
          const updates = { role, allowedSites, allowedApps };
          if (u.password && u.password.length >= 6) {
            const { hash, salt } = hashPassword(u.password);
            updates.passwordHash = hash;
            updates.salt = salt;
          }
          await db.updateUser(username, updates);
          // Update in-memory
          const idx = users.findIndex(eu => eu.username.toLowerCase() === username.toLowerCase());
          if (idx >= 0) {
            users[idx].role = role;
            users[idx].allowedSites = allowedSites;
            users[idx].allowedApps = allowedApps;
            if (updates.passwordHash) { users[idx].passwordHash = updates.passwordHash; users[idx].salt = updates.salt; }
          }
          updated++;
        } catch (e) { errors.push(username + ': ' + e.message); }
      } else {
        // Create new user
        const password = u.password && u.password.length >= 6 ? u.password : 'password123';
        try {
          const { hash, salt } = hashPassword(password);
          await db.createUser(username, hash, salt, role, allowedSites, allowedApps);
          users.push({ username, passwordHash: hash, salt, role, allowedSites, allowedApps });
          created++;
        } catch (e) { errors.push(username + ': ' + e.message); }
      }
    }

    res.json({ ok: true, created, updated, errors });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ========== SAFETY APP ROUTES (JSA) ==========
// Serve safety landing page
app.get('/safety/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'safety', 'index.html'));
});

// Serve safety JSA form page
app.get('/safety/form', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'safety', 'form.html'));
});

// Serve safety records page
app.get('/safety/records', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'safety', 'records.html'));
});

// API: Save JSA PDF record
app.post('/safety/api/save-jsa', async (req, res) => {
  try {
    const { siteName, descriptionOfWork, pdfBase64 } = req.body;
    if (!pdfBase64 || !siteName) {
      return res.status(400).json({ error: 'Missing required fields: siteName and pdfBase64' });
    }
    const pdfBuffer = Buffer.from(pdfBase64, 'base64');
    const record = await db.saveJsaRecord(siteName, descriptionOfWork, pdfBuffer);
    console.log(`JSA saved: ID=${record.id}, Site="${record.site_name}", Date=${record.saved_at}, Size=${record.file_size} bytes`);
    res.json({
      success: true,
      record: {
        id: record.id,
        siteName: record.site_name,
        savedAt: record.saved_at,
        fileSize: record.file_size
      }
    });
  } catch (err) {
    console.error('Error saving JSA:', err.message);
    res.status(500).json({ error: 'Failed to save JSA record' });
  }
});

// API: List all saved JSA records
app.get('/safety/api/jsa-records', async (req, res) => {
  try {
    const records = await db.getJsaRecords();
    res.json(records);
  } catch (err) {
    console.error('Error fetching JSA records:', err.message);
    res.status(500).json({ error: 'Failed to fetch records' });
  }
});

// API: Download a saved JSA PDF by ID
app.get('/safety/api/jsa-records/:id/pdf', async (req, res) => {
  try {
    const row = await db.getJsaRecordPdf(req.params.id);
    if (!row) {
      return res.status(404).json({ error: 'Record not found' });
    }
    const dateStr = new Date(row.saved_at).toISOString().slice(0, 10);
    const filename = `JSA_${row.site_name.replace(/[^a-zA-Z0-9]/g, '_')}_${dateStr}.pdf`;
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(row.pdf_data);
  } catch (err) {
    console.error('Error downloading JSA PDF:', err.message);
    res.status(500).json({ error: 'Failed to download PDF' });
  }
});

// ========== STARTUP ==========
async function startServer() {
  try {
    // 1. Initialize database schema
    console.log('Initializing PostgreSQL database...');
    await db.initDB();

    // 2. Load users from DB
    users = await db.getUsers();
    if (!users.length) {
      // Create default super admin
      const { hash, salt } = hashPassword('admin123');
      await db.createUser('admin', hash, salt, 'superadmin', []);
      users = await db.getUsers();
      console.log('Created default super admin account (admin / admin123)');
    }
    // Ensure at least one superadmin exists
    if (!users.some(u => u.role === 'superadmin')) {
      const firstAdmin = users.find(u => u.role === 'admin');
      if (firstAdmin) {
        await db.updateUser(firstAdmin.username, { role: 'superadmin' });
        firstAdmin.role = 'superadmin';
        console.log('Migrated ' + firstAdmin.username + ' to superadmin');
      }
    }
    console.log(`Loaded ${users.length} users from database`);

    // 3. Determine default app (Safety first for UI, but load Task Tracker sites for backend)
    const allApps = await db.getApps();
    const safetyApp = allApps.find(a => a.name.toLowerCase() === 'safety');
    activeAppId = safetyApp ? safetyApp.id : (allApps[0] ? allApps[0].id : 1);

    // 4. Load sites for Task Tracker (the app that uses sites/state)
    const trackerApp = allApps.find(a => a.name.toLowerCase() === 'task tracker');
    const trackerAppId = trackerApp ? trackerApp.id : activeAppId;
    sites = await db.getSites(trackerAppId);
    if (!sites.length) {
      // Check if JSON data exists for migration
      const sitesFile = path.join(DATA_DIR, 'sites.json');
      if (fs.existsSync(sitesFile)) {
        console.log('Migrating existing JSON data to PostgreSQL...');
        await db.migrateFromJSON(DATA_DIR);
        // Assign migrated sites to Task Tracker app
        const allSites = await db.getSites();
        for (const s of allSites) {
          if (!s.app_id || s.app_id === 1) {
            await db.pool.query('UPDATE sites SET app_id=$1 WHERE id=$2', [trackerAppId, s.id]);
          }
        }
        sites = await db.getSites(trackerAppId);
        users = await db.getUsers();
        console.log('Migration complete!');
      } else {
        // Create default site for Task Tracker
        await db.createSite('default', 'Default Site', trackerAppId);
        sites = await db.getSites(trackerAppId);
        console.log('Created default site');
      }
    }
    console.log(`Loaded ${sites.length} sites from database`);

    // 5. Load active site state
    if (sites.length > 0) {
      activeSiteId = sites[0].id;
      state = await db.loadSiteState(activeSiteId);
      console.log(`Active site: ${sites[0].name} (${activeSiteId})`);
    } else {
      console.log('No sites loaded (Safety/Users app has no sites)');
    }

    // 5. Auto-import if empty
    autoImportFromTrackerFolder();

    // 6. Start HTTP server
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
