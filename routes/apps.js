const router = require('express').Router();
const db = require('../db');
const { asyncHandler } = require('../middleware/errorHandler');
const { authRequired, superAdminRequired } = require('./auth');
const appState = require('../shared/appState');

router.get('/apps', authRequired, asyncHandler(async (req, res) => {
  const apps = await db.getApps();
  if (req.user.role === 'superadmin') return res.json({ apps });
  const users = appState.getUsers();
  const userRecord = users.find(u => u.username.toLowerCase() === req.user.username.toLowerCase());
  const allowedApps = userRecord ? (userRecord.allowedApps || []) : [];
  const isAdmin = req.user.role === 'admin';
  const filtered = apps.filter(a => {
    if (a.name.toLowerCase() === 'users') return isAdmin;
    if (a.isBuiltin) return true;
    return allowedApps.includes(a.id);
  });
  res.json({ apps: filtered });
}));

router.post('/apps', authRequired, superAdminRequired, asyncHandler(async (req, res) => {
  const { name, icon } = req.body;
  if (!name || !name.trim()) return res.status(400).json({ error: 'App name required' });
  const newApp = await db.createApp(name.trim(), icon || 'folder');
  res.json({ ok: true, app: newApp });
}));

router.put('/apps/:id', authRequired, superAdminRequired, asyncHandler(async (req, res) => {
  const id = parseInt(req.params.id);
  const { name, icon, sortOrder } = req.body;
  await db.updateApp(id, { name, icon, sortOrder });
  res.json({ ok: true });
}));

router.delete('/apps/:id', authRequired, superAdminRequired, asyncHandler(async (req, res) => {
  const id = parseInt(req.params.id);
  await db.deleteApp(id);
  res.json({ ok: true });
}));

router.post('/apps/:id/switch', authRequired, asyncHandler(async (req, res) => {
  const appId = parseInt(req.params.id);
  const users = appState.getUsers();

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

  appState.setActiveAppId(appId);
  let sites = await db.getSites(appId);

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

  appState.setSites(sites);

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

  let state = null;
  if (userSites.length > 0) {
    appState.setActiveSiteId(userSites[0].id);
    state = await db.loadSiteState(userSites[0].id);
    appState.setState(state);
  }

  res.json({
    ok: true,
    sites: userSites,
    activeSiteId: userSites.length > 0 ? userSites[0].id : '',
    state: userSites.length > 0 ? state : null
  });
}));

module.exports = router;
