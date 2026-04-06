const router = require('express').Router();
const db = require('../db');
const { asyncHandler } = require('../middleware/errorHandler');
const { auditLog } = require('../middleware/audit');
const { authRequired, superAdminRequired } = require('./auth');
const appState = require('../shared/appState');

// Get ALL sites across all apps (for user access assignment)
router.get('/all-sites', authRequired, asyncHandler(async (req, res) => {
  if (req.user.role !== 'superadmin' && req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Admin access required' });
  }
  const allSites = await db.getSites();
  res.json(allSites);
}));

router.get('/sites', authRequired, (req, res) => {
  const sites = appState.getSites();
  const activeSiteId = appState.getActiveSiteId();
  const activeAppId = appState.getActiveAppId();

  if (req.user.role === 'superadmin') {
    return res.json({ sites, activeSiteId, activeAppId });
  }
  const users = appState.getUsers();
  const userRecord = users.find(u => u.username.toLowerCase() === req.user.username.toLowerCase());
  const allowedSites = userRecord ? (userRecord.allowedSites || []) : [];
  if (allowedSites.length > 0) {
    const visibleSites = sites.filter(s => allowedSites.includes(s.id));
    return res.json({ sites: visibleSites, activeSiteId, activeAppId });
  }
  res.json({ sites: [], activeSiteId, activeAppId });
});

router.post('/sites', authRequired, superAdminRequired, asyncHandler(async (req, res) => {
  const { name } = req.body;
  if (!name || !name.trim()) return res.status(400).json({ error: 'Site name required' });
  const trimmed = name.trim();
  const sites = appState.getSites();
  const activeAppId = appState.getActiveAppId();
  if (sites.find(s => s.name.toLowerCase() === trimmed.toLowerCase())) return res.status(400).json({ error: 'Site already exists' });
  const id = trimmed.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') + '-' + activeAppId || ('site-' + Date.now());
  await db.createSite(id, trimmed, activeAppId);
  const newSite = { id, name: trimmed, appId: activeAppId };
  sites.push(newSite);
  auditLog('site_created', req.user.username, { siteName: name }, req);
  res.json({ ok: true, site: newSite });
}));

router.delete('/sites/:id', authRequired, superAdminRequired, asyncHandler(async (req, res) => {
  const id = req.params.id;
  const sites = appState.getSites();
  if (sites.length <= 1) return res.status(400).json({ error: 'Cannot delete the last site' });
  const idx = sites.findIndex(s => s.id === id);
  if (idx === -1) return res.status(404).json({ error: 'Site not found' });
  await db.deleteSite(id);
  sites.splice(idx, 1);
  if (appState.getActiveSiteId() === id) {
    appState.setActiveSiteId(sites[0].id);
    appState.setState(await db.loadSiteState(sites[0].id));
  }
  auditLog('site_deleted', req.user.username, { siteId: id }, req);
  res.json({ ok: true });
}));

router.post('/sites/:id/switch', authRequired, asyncHandler(async (req, res) => {
  const id = req.params.id;
  const sites = appState.getSites();
  const site = sites.find(s => s.id === id);
  if (!site) return res.status(404).json({ error: 'Site not found' });
  if (req.user.role !== 'superadmin') {
    const users = appState.getUsers();
    const userRecord = users.find(u => u.username.toLowerCase() === req.user.username.toLowerCase());
    const allowedSites = userRecord ? (userRecord.allowedSites || []) : [];
    if (allowedSites.length > 0 && !allowedSites.includes(id)) {
      return res.status(403).json({ error: 'No access to this site' });
    }
    if (allowedSites.length === 0) {
      return res.status(403).json({ error: 'No sites assigned to your account' });
    }
  }
  appState.setActiveSiteId(id);
  const state = await db.loadSiteState(id);
  appState.setState(state);
  res.json({ ok: true, state });
}));

router.put('/sites/:id', authRequired, superAdminRequired, asyncHandler(async (req, res) => {
  const id = req.params.id;
  const { name } = req.body;
  if (!name || !name.trim()) return res.status(400).json({ error: 'Site name required' });
  const sites = appState.getSites();
  const site = sites.find(s => s.id === id);
  if (!site) return res.status(404).json({ error: 'Site not found' });
  await db.renameSite(id, name.trim());
  site.name = name.trim();
  res.json({ ok: true, site });
}));

module.exports = router;
