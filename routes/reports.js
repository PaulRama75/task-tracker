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

// ===== TIR API ENDPOINTS =====

// --- TIR Users ---

router.post('/api/tir/login', authRequired, asyncHandler(async (req, res) => {
  const { name, role, api_cert } = req.body;
  const user = await db.tirLogin(name, role, api_cert);
  res.json(user);
}));

router.get('/api/tir/users', authRequired, asyncHandler(async (req, res) => {
  const users = await db.getTirUsers();
  res.json(users);
}));

router.post('/api/tir/users', authRequired, asyncHandler(async (req, res) => {
  const { name, role, api_cert, is_admin } = req.body;
  const user = await db.createTirUser(name, role, api_cert, is_admin);
  res.json(user);
}));

router.put('/api/tir/users/:id', authRequired, asyncHandler(async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const updated = await db.updateTirUser(id, req.body);
  res.json(updated);
}));

router.delete('/api/tir/users/:id', authRequired, asyncHandler(async (req, res) => {
  const id = parseInt(req.params.id, 10);
  try {
    const result = await db.deleteTirUser(id);
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
}));

// --- TIR Sites ---

router.get('/api/tir/sites', authRequired, asyncHandler(async (req, res) => {
  const sites = await db.getTirSites();
  res.json(sites);
}));

router.post('/api/tir/sites', authRequired, asyncHandler(async (req, res) => {
  const { client_name, plant_name, location, enabled_types } = req.body;
  const site = await db.createTirSite(client_name, plant_name, location, enabled_types);
  res.json(site);
}));

router.put('/api/tir/sites/:id', authRequired, asyncHandler(async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const updated = await db.updateTirSite(id, req.body);
  res.json(updated);
}));

router.delete('/api/tir/sites/:id', authRequired, asyncHandler(async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const result = await db.deleteTirSite(id);
  res.json(result);
}));

router.post('/api/tir/sites/:id/assign-user', authRequired, asyncHandler(async (req, res) => {
  const siteId = parseInt(req.params.id, 10);
  const { userId } = req.body;
  const result = await db.assignTirUserToSite(userId, siteId);
  res.json(result || { ok: true });
}));

router.post('/api/tir/sites/:id/remove-user', authRequired, asyncHandler(async (req, res) => {
  const siteId = parseInt(req.params.id, 10);
  const { userId } = req.body;
  const result = await db.removeTirUserFromSite(userId, siteId);
  res.json(result || { ok: true });
}));

router.get('/api/tir/users/:id/sites', authRequired, asyncHandler(async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const sites = await db.getTirUserSites(id);
  res.json(sites);
}));

// --- TIR Reports ---

router.get('/api/tir/reports', authRequired, asyncHandler(async (req, res) => {
  const reports = await db.getTirReports();
  res.json(reports);
}));

router.post('/api/tir/reports', authRequired, asyncHandler(async (req, res) => {
  const report = await db.createTirReport(req.body);
  res.json(report);
}));

router.get('/api/tir/reports/:id', authRequired, asyncHandler(async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const report = await db.getTirReport(id);
  if (!report) return res.status(404).json({ error: 'Report not found' });
  res.json(report);
}));

router.put('/api/tir/reports/:id/status', authRequired, asyncHandler(async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const { status, userId, extra } = req.body;
  const result = await db.updateTirReportStatus(id, status, userId, extra);
  res.json(result);
}));

router.delete('/api/tir/reports/:id', authRequired, asyncHandler(async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const result = await db.deleteTirReport(id);
  res.json(result);
}));

// --- TIR Sections ---

router.put('/api/tir/reports/:id/sections/:key', authRequired, asyncHandler(async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const key = req.params.key;
  const { sectionData, userId } = req.body;
  const result = await db.tirSaveSection(id, key, sectionData, userId);
  res.json(result);
}));

// --- TIR Locks ---

router.post('/api/tir/reports/:id/lock', authRequired, asyncHandler(async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const { userId } = req.body;
  try {
    const result = await db.tirAcquireLock(id, userId);
    res.json(result);
  } catch (err) {
    res.status(409).json({ error: err.message });
  }
}));

router.delete('/api/tir/reports/:id/lock', authRequired, asyncHandler(async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const { userId } = req.body;
  const result = await db.tirReleaseLock(id, userId);
  res.json(result);
}));

router.delete('/api/tir/reports/:id/lock/force', authRequired, asyncHandler(async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const result = await db.tirForceUnlock(id);
  res.json(result);
}));

// --- TIR Photos ---

router.post('/api/tir/reports/:id/photos', authRequired, asyncHandler(async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const result = await db.tirAddPhoto(id, req.body);
  res.json(result);
}));

router.delete('/api/tir/reports/:id/photos/:photoId', authRequired, asyncHandler(async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const photoId = parseInt(req.params.photoId, 10);
  const result = await db.tirDeletePhoto(id, photoId);
  res.json(result);
}));

// --- TIR Attachments ---

router.get('/api/tir/reports/:id/attachments', authRequired, asyncHandler(async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const attachments = await db.getTirAttachments(id);
  res.json(attachments);
}));

router.post('/api/tir/reports/:id/attachments', authRequired, asyncHandler(async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const result = await db.tirAddAttachment(id, req.body);
  res.json(result);
}));

router.delete('/api/tir/reports/:id/attachments/:attId', authRequired, asyncHandler(async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const attId = parseInt(req.params.attId, 10);
  const result = await db.tirDeleteAttachment(id, attId);
  res.json(result);
}));

// --- TIR Versions ---

router.get('/api/tir/reports/:id/versions', authRequired, asyncHandler(async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const versions = await db.getTirVersions(id);
  res.json(versions);
}));

router.post('/api/tir/reports/:id/versions', authRequired, asyncHandler(async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const { userId } = req.body;
  const result = await db.tirCreateVersion(id, userId);
  res.json(result);
}));

// --- TIR Final Reports ---

router.post('/api/tir/reports/:id/finalize', authRequired, asyncHandler(async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const { userId, pdfDataUrl } = req.body;
  const result = await db.tirFinalizeReport(id, userId, pdfDataUrl);
  res.json(result);
}));

router.get('/api/tir/final-reports', authRequired, asyncHandler(async (req, res) => {
  const reports = await db.getTirFinalReports();
  res.json(reports);
}));

router.delete('/api/tir/final-reports/:id', authRequired, asyncHandler(async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const result = await db.deleteTirFinalReport(id);
  res.json(result);
}));

// --- TIR Equipment ---

router.get('/api/tir/equipment', authRequired, asyncHandler(async (req, res) => {
  const { reportType, siteId } = req.query;
  const equipment = await db.getTirEquipment(reportType, siteId);
  res.json(equipment);
}));

router.get('/api/tir/equipment/all', authRequired, asyncHandler(async (req, res) => {
  const equipment = await db.getAllTirEquipment();
  res.json(equipment);
}));

router.get('/api/tir/equipment/by-num', authRequired, asyncHandler(async (req, res) => {
  const { equipNum, reportType } = req.query;
  const equipment = await db.getTirEquipmentById(equipNum, reportType);
  res.json(equipment);
}));

router.post('/api/tir/equipment/import', authRequired, asyncHandler(async (req, res) => {
  const { items } = req.body;
  const result = await db.tirImportEquipment(items);
  res.json(result);
}));

router.post('/api/tir/equipment/bulk-delete', authRequired, asyncHandler(async (req, res) => {
  const { ids } = req.body;
  const deleted = await db.bulkDeleteTirEquipment(ids);
  res.json({ deleted });
}));

router.delete('/api/tir/equipment/:id', authRequired, asyncHandler(async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const result = await db.deleteTirEquipment(id);
  res.json(result);
}));

module.exports = router;
