const router = require('express').Router();
const path = require('path');
const db = require('../db');
const { asyncHandler } = require('../middleware/errorHandler');
const { authRequired } = require('./auth');
const appState = require('../shared/appState');

// Serve reports pages
router.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'reports', 'index.html'));
});

// API: Get current user info and permissions
router.get('/api/me', authRequired, (req, res) => {
  const users = appState.getUsers();
  const userRecord = users.find(u => u.username.toLowerCase() === req.user.username.toLowerCase());
  res.json({
    username: req.user.username,
    role: req.user.role,
    allowedSites: userRecord ? (userRecord.allowedSites || []) : [],
    allowedApps: userRecord ? (userRecord.allowedApps || []) : []
  });
});

// API: Get all sites (filtered by user permissions)
router.get('/api/sites', authRequired, asyncHandler(async (req, res) => {
  const allSites = await db.getSites();
  if (req.user.role === 'superadmin') return res.json(allSites);

  const users = appState.getUsers();
  const userRecord = users.find(u => u.username.toLowerCase() === req.user.username.toLowerCase());
  const allowedSites = userRecord ? (userRecord.allowedSites || []) : [];

  if (allowedSites.length === 0) return res.json([]);
  const filtered = allSites.filter(s => allowedSites.includes(s.id));
  res.json(filtered);
}));

module.exports = router;
