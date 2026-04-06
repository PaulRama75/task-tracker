const router = require('express').Router();
const { asyncHandler } = require('../middleware/errorHandler');
const { auditLog } = require('../middleware/audit');
const { authRequired, adminRequired } = require('./auth');
const appState = require('../shared/appState');
const db = require('../db');

router.get('/sections', authRequired, (req, res) => {
  const state = appState.getState();
  res.json(Object.keys(state.sections));
});

router.post('/sections', authRequired, adminRequired, asyncHandler(async (req, res) => {
  const { name } = req.body;
  if (!name || !name.trim()) return res.status(400).json({ error: 'Section name required' });
  const key = name.trim().toUpperCase();
  const state = appState.getState();
  if (state.sections[key]) return res.status(400).json({ error: 'Section already exists' });
  state.sections[key] = appState.emptySection(key);
  await saveState(state);
  auditLog('section_created', req.user.username, { sectionName: key }, req);
  res.json({ ok: true, name: key });
}));

router.delete('/sections/:name', authRequired, adminRequired, asyncHandler(async (req, res) => {
  const key = req.params.name.toUpperCase();
  const state = appState.getState();
  if (!state.sections[key]) return res.status(404).json({ error: 'Section not found' });
  if (Object.keys(state.sections).length <= 1) return res.status(400).json({ error: 'Cannot delete the last section' });
  delete state.sections[key];
  if (state.activeSection === key) state.activeSection = Object.keys(state.sections)[0];
  await saveState(state);
  auditLog('section_deleted', req.user.username, { sectionName: key }, req);
  res.json({ ok: true });
}));

router.post('/sections/:name/duplicate', authRequired, adminRequired, asyncHandler(async (req, res) => {
  const sourceKey = req.params.name.toUpperCase();
  const { newName } = req.body;
  if (!newName || !newName.trim()) return res.status(400).json({ error: 'New section name required' });
  const targetKey = newName.trim().toUpperCase();
  const state = appState.getState();
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
  await saveState(state);
  res.json({ ok: true, name: targetKey });
}));

async function saveState(state) {
  try {
    await db.saveSiteState(appState.getActiveSiteId(), state);
  } catch (e) {
    console.error('Error saving state to DB:', e.message);
  }
}

module.exports = router;
