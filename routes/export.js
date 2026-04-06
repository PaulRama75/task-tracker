const router = require('express').Router();
const XLSX = require('xlsx');
const { auditLog } = require('../middleware/audit');
const { authRequired } = require('./auth');
const { parsePagination } = require('../shared/pagination');
const appState = require('../shared/appState');
const db = require('../db');

// Paginated tracker rows for a section
router.get('/tracker-rows', authRequired, async (req, res) => {
  const sectionName = (req.query.section || '').toUpperCase();
  if (!sectionName) {
    return res.status(400).json({ error: 'section query parameter is required' });
  }
  const activeSiteId = appState.getActiveSiteId();
  const sectionId = await db.getSectionId(activeSiteId, sectionName);
  if (!sectionId) {
    return res.status(404).json({ error: 'Section not found' });
  }
  const { page, limit, offset } = parsePagination(req);
  const { rows, total } = await db.getTrackerRowsPaginated(sectionId, offset, limit);
  res.json({ rows, total, page, limit, totalPages: Math.ceil(total / limit) });
});

router.get('/export/:section/tracker.xlsx', authRequired, (req, res) => {
  const key = req.params.section.toUpperCase();
  const state = appState.getState();
  const sec = state.sections[key];
  if (!sec) return res.status(404).json({ error: 'Section not found' });
  auditLog('data_exported', req.user.username, { type: 'xlsx' }, req);
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

router.get('/export/:section/tracker.csv', authRequired, (req, res) => {
  const key = req.params.section.toUpperCase();
  const state = appState.getState();
  const sec = state.sections[key];
  if (!sec) return res.status(404).json({ error: 'Section not found' });
  auditLog('data_exported', req.user.username, { type: 'csv' }, req);
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

router.get('/export/kpi.csv', authRequired, (req, res) => {
  const state = appState.getState();
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
  auditLog('data_exported', req.user.username, { type: 'csv' }, req);
  res.send(csv);
});

router.get('/export/backup.json', authRequired, (req, res) => {
  auditLog('data_exported', req.user.username, { type: 'json' }, req);
  res.setHeader('Content-Disposition', 'attachment; filename="tracker-backup.json"');
  res.json(appState.getState());
});

module.exports = router;
