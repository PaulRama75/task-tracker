const router = require('express').Router();
const XLSX = require('xlsx');
const fs = require('fs');
const db = require('../db');
const { validatedUpload } = require('../middleware/uploadValidation');
const { asyncHandler } = require('../middleware/errorHandler');
const { auditLog } = require('../middleware/audit');
const { authRequired, adminRequired } = require('./auth');
const appState = require('../shared/appState');

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

// ========== SAVE STATE HELPER ==========
async function saveState(state) {
  try {
    await db.saveSiteState(appState.getActiveSiteId(), state);
  } catch (e) {
    console.error('Error saving state to DB:', e.message);
  }
}

// ========== UPLOAD ROUTES ==========
router.post('/upload/:section/weight', authRequired, adminRequired, validatedUpload.single('file'), asyncHandler(async (req, res) => {
  const key = req.params.section.toUpperCase();
  const state = appState.getState();
  const sec = state.sections[key];
  if (!sec) return res.status(404).json({ error: 'Section not found' });
  const wb = XLSX.readFile(req.file.path);
  sec.weights = parseWeightWorkbook(wb);
  await saveState(state);
  fs.unlinkSync(req.file.path);
  auditLog('data_imported', req.user.username, { type: 'weight', section: key }, req);
  res.json({ ok: true, count: sec.weights.length, weights: sec.weights });
}));

router.post('/upload/initials', authRequired, adminRequired, validatedUpload.single('file'), asyncHandler(async (req, res) => {
  const state = appState.getState();
  const wb = XLSX.readFile(req.file.path);
  state.initials = parseInitialsWorkbook(wb);
  await saveState(state);
  fs.unlinkSync(req.file.path);
  auditLog('data_imported', req.user.username, { type: 'initials' }, req);
  res.json({ ok: true, count: state.initials.length, initials: state.initials });
}));

router.post('/upload/:section/tracker', authRequired, adminRequired, validatedUpload.single('file'), asyncHandler(async (req, res) => {
  const key = req.params.section.toUpperCase();
  const state = appState.getState();
  const sec = state.sections[key];
  if (!sec) return res.status(404).json({ error: 'Section not found' });
  const wb = XLSX.readFile(req.file.path);
  const result = parseTrackerWorkbook(wb);
  sec.taskCols = result.taskCols;
  sec.infoCols = result.infoCols;
  sec.rows = result.rows;
  sec.originalHeaders = result.originalHeaders;
  state.page = 0;
  await saveState(state);
  fs.unlinkSync(req.file.path);
  auditLog('data_imported', req.user.username, { type: 'tracker', section: key }, req);
  res.json({ ok: true, rows: sec.rows.length, taskCols: sec.taskCols.length, infoCols: sec.infoCols.length });
}));

router.post('/import/backup', authRequired, adminRequired, validatedUpload.single('file'), asyncHandler(async (req, res) => {
  const data = fs.readFileSync(req.file.path, 'utf8');
  const newState = JSON.parse(data);
  appState.setState(newState);
  await saveState(newState);
  fs.unlinkSync(req.file.path);
  auditLog('data_imported', req.user.username, { type: 'backup' }, req);
  res.json({ ok: true });
}));

module.exports = router;
module.exports.parseWeightWorkbook = parseWeightWorkbook;
module.exports.parseInitialsWorkbook = parseInitialsWorkbook;
module.exports.parseTrackerWorkbook = parseTrackerWorkbook;
module.exports.uid = uid;
