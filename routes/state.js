const router = require('express').Router();
const db = require('../db');
const { asyncHandler } = require('../middleware/errorHandler');
const { authRequired, adminRequired } = require('./auth');
const { parsePagination } = require('../shared/pagination');
const appState = require('../shared/appState');

router.get('/state', authRequired, (req, res) => {
  res.json(appState.getState());
});

router.post('/state', authRequired, asyncHandler(async (req, res) => {
  const newState = req.body;
  appState.setState(newState);
  try {
    await db.saveSiteState(appState.getActiveSiteId(), newState);
  } catch (e) {
    console.error('Error saving state to DB:', e.message);
  }
  res.json({ ok: true });
}));

// Paginated audit log
router.get('/audit-log', authRequired, adminRequired, asyncHandler(async (req, res) => {
  const { page, limit, offset } = parsePagination(req);
  const filters = {};
  if (req.query.action) filters.action = req.query.action;
  if (req.query.username) filters.username = req.query.username;
  if (req.query.startDate) filters.startDate = req.query.startDate;
  if (req.query.endDate) filters.endDate = req.query.endDate;
  const { rows, total } = await db.getAuditLogPaginated(offset, limit, filters);
  res.json({ rows, total, page, limit, totalPages: Math.ceil(total / limit) });
}));

module.exports = router;
