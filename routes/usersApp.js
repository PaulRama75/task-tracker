const router = require('express').Router();
const path = require('path');
const XLSX = require('xlsx');
const fs = require('fs');
const db = require('../db');
const { asyncHandler } = require('../middleware/errorHandler');
const { validatedUpload } = require('../middleware/uploadValidation');
const { authRequired, adminRequired, superAdminRequired, hashPasswordSecure } = require('./auth');
const appState = require('../shared/appState');

// Serve users management page
router.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'users', 'index.html'));
});

// Get ALL sites across all apps (for user access assignment)
router.get('/api/all-sites', authRequired, adminRequired, asyncHandler(async (req, res) => {
  const allSites = await db.getSites();
  res.json(allSites);
}));

// Export users to Excel
router.get('/api/export', authRequired, adminRequired, asyncHandler(async (req, res) => {
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
  ws['!cols'] = [{ wch: 20 }, { wch: 15 }, { wch: 30 }, { wch: 40 }];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Users');
  const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
  res.setHeader('Content-Disposition', 'attachment; filename="users-export.xlsx"');
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.send(buf);
}));

// Import preview — parse Excel and show what will happen
router.post('/api/import-preview', authRequired, superAdminRequired, validatedUpload.single('file'), asyncHandler(async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
  const wb = XLSX.readFile(req.file.path);
  const ws = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(ws, { header: 1, raw: false, defval: '' });
  fs.unlinkSync(req.file.path);

  if (rows.length < 2) return res.status(400).json({ error: 'File has no data rows' });

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
}));

// Import confirm — create/update users
router.post('/api/import', authRequired, superAdminRequired, asyncHandler(async (req, res) => {
  const { users: importUsers } = req.body;
  if (!importUsers || !importUsers.length) return res.status(400).json({ error: 'No users to import' });

  const allApps = await db.getApps();
  const allSites = await db.getSites();
  const existingUsers = await db.getUsers();
  const memUsers = appState.getUsers();

  let created = 0, updated = 0, errors = [];

  for (const u of importUsers) {
    const username = String(u.username || '').trim();
    if (!username) continue;

    let role = String(u.role || 'user').trim().toLowerCase();
    if (!['superadmin', 'admin', 'user'].includes(role)) role = 'user';

    const allowedApps = [];
    if (u.allowedApps) {
      String(u.allowedApps).split(',').forEach(name => {
        const n = name.trim().toLowerCase();
        if (!n) return;
        const app = allApps.find(a => a.name.toLowerCase() === n);
        if (app) allowedApps.push(app.id);
      });
    }

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
      try {
        const updates = { role, allowedSites, allowedApps };
        if (u.password && u.password.length >= 6) {
          const { hash, salt } = await hashPasswordSecure(u.password);
          updates.passwordHash = hash;
          updates.salt = salt;
        }
        await db.updateUser(username, updates);
        const idx = memUsers.findIndex(eu => eu.username.toLowerCase() === username.toLowerCase());
        if (idx >= 0) {
          memUsers[idx].role = role;
          memUsers[idx].allowedSites = allowedSites;
          memUsers[idx].allowedApps = allowedApps;
          if (updates.passwordHash) { memUsers[idx].passwordHash = updates.passwordHash; memUsers[idx].salt = updates.salt; }
        }
        updated++;
      } catch (e) { errors.push(username + ': ' + e.message); }
    } else {
      const password = u.password && u.password.length >= 6 ? u.password : 'password123';
      try {
        const { hash, salt } = await hashPasswordSecure(password);
        await db.createUser(username, hash, salt, role, allowedSites, allowedApps);
        memUsers.push({ username, passwordHash: hash, salt, role, allowedSites, allowedApps });
        created++;
      } catch (e) { errors.push(username + ': ' + e.message); }
    }
  }

  res.json({ ok: true, created, updated, errors });
}));

module.exports = router;
