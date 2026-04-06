const router = require('express').Router();
const db = require('../db');
const sessionStore = require('../middleware/sessionStore');
const { asyncHandler } = require('../middleware/errorHandler');
const { auditLog } = require('../middleware/audit');
const { authRequired, adminRequired, superAdminRequired, hashPasswordSecure } = require('./auth');
const appState = require('../shared/appState');

router.get('/users', authRequired, adminRequired, (req, res) => {
  const users = appState.getUsers();
  res.json(users.map(u => ({ username: u.username, role: u.role, allowedSites: u.allowedSites || [], allowedApps: u.allowedApps || [] })));
});

router.post('/users', authRequired, adminRequired, asyncHandler(async (req, res) => {
  const { username, password, role, allowedSites, allowedApps } = req.body;
  if (!username || !password) return res.status(400).json({ error: 'Username and password required' });
  const validRoles = ['superadmin', 'admin', 'user'];
  if (!validRoles.includes(role)) return res.status(400).json({ error: 'Role must be superadmin, admin, or user' });
  if ((role === 'superadmin' || role === 'admin') && req.user.role !== 'superadmin') return res.status(403).json({ error: 'Only Super Admin can create admin/superadmin users' });
  const users = appState.getUsers();
  if (users.find(u => u.username.toLowerCase() === username.toLowerCase())) return res.status(400).json({ error: 'Username already exists' });
  const { hash, salt } = await hashPasswordSecure(password);
  await db.createUser(username, hash, salt, role, allowedSites || [], allowedApps || []);
  users.push({ username, passwordHash: hash, salt, role, allowedSites: allowedSites || [], allowedApps: allowedApps || [] });
  auditLog('user_created', req.user.username, { target: username, role }, req);
  res.json({ ok: true });
}));

router.delete('/users/:username', authRequired, superAdminRequired, asyncHandler(async (req, res) => {
  const target = req.params.username;
  if (target.toLowerCase() === req.user.username.toLowerCase()) return res.status(400).json({ error: 'Cannot delete your own account' });
  const users = appState.getUsers();
  const idx = users.findIndex(u => u.username.toLowerCase() === target.toLowerCase());
  if (idx === -1) return res.status(404).json({ error: 'User not found' });
  await db.deleteUser(target);
  users.splice(idx, 1);
  await sessionStore.destroyByUsername(target);
  auditLog('user_deleted', req.user.username, { target }, req);
  res.json({ ok: true });
}));

router.put('/users/:username/password', authRequired, asyncHandler(async (req, res) => {
  const target = req.params.username;
  if (req.user.role !== 'admin' && req.user.role !== 'superadmin' && req.user.username.toLowerCase() !== target.toLowerCase()) {
    return res.status(403).json({ error: 'Cannot change another user\'s password' });
  }
  const { password } = req.body;
  if (!password || password.length < 6) return res.status(400).json({ error: 'Password must be at least 6 characters' });
  const users = appState.getUsers();
  const user = users.find(u => u.username.toLowerCase() === target.toLowerCase());
  if (!user) return res.status(404).json({ error: 'User not found' });
  const { hash, salt } = await hashPasswordSecure(password);
  await db.updateUser(target, { passwordHash: hash, salt });
  user.passwordHash = hash;
  user.salt = salt;
  auditLog('password_changed', req.user.username, { target }, req);
  res.json({ ok: true });
}));

router.put('/users/:username/role', authRequired, adminRequired, asyncHandler(async (req, res) => {
  const target = req.params.username;
  if (target.toLowerCase() === req.user.username.toLowerCase()) return res.status(400).json({ error: 'Cannot change your own role' });
  const { role, allowedSites } = req.body;
  const validRoles = ['superadmin', 'admin', 'user'];
  if (!validRoles.includes(role)) return res.status(400).json({ error: 'Role must be superadmin, admin, or user' });
  if (role === 'superadmin' && req.user.role !== 'superadmin') return res.status(403).json({ error: 'Only Super Admin can assign superadmin role' });
  const users = appState.getUsers();
  const user = users.find(u => u.username.toLowerCase() === target.toLowerCase());
  if (!user) return res.status(404).json({ error: 'User not found' });
  const updates = { role };
  if (allowedSites !== undefined) updates.allowedSites = allowedSites;
  await db.updateUser(target, updates);
  user.role = role;
  if (allowedSites !== undefined) user.allowedSites = allowedSites;
  auditLog('role_changed', req.user.username, { target, newRole: role }, req);
  res.json({ ok: true });
}));

router.put('/users/:username/sites', authRequired, superAdminRequired, asyncHandler(async (req, res) => {
  const target = req.params.username;
  const { allowedSites } = req.body;
  const users = appState.getUsers();
  const user = users.find(u => u.username.toLowerCase() === target.toLowerCase());
  if (!user) return res.status(404).json({ error: 'User not found' });
  await db.updateUser(target, { allowedSites: allowedSites || [] });
  user.allowedSites = allowedSites || [];
  res.json({ ok: true });
}));

router.put('/users/:username/access', authRequired, superAdminRequired, asyncHandler(async (req, res) => {
  const target = req.params.username;
  const { allowedSites, allowedApps } = req.body;
  const users = appState.getUsers();
  const user = users.find(u => u.username.toLowerCase() === target.toLowerCase());
  if (!user) return res.status(404).json({ error: 'User not found' });
  const updates = {};
  if (allowedSites !== undefined) updates.allowedSites = allowedSites;
  if (allowedApps !== undefined) updates.allowedApps = allowedApps;
  await db.updateUser(target, updates);
  if (allowedSites !== undefined) user.allowedSites = allowedSites;
  if (allowedApps !== undefined) user.allowedApps = allowedApps;
  res.json({ ok: true });
}));

module.exports = router;
