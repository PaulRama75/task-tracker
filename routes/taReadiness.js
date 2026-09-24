// TA Readiness AI app: work packages, document upload, AI cross-check review,
// human verification and approval. Mounted at /readiness.
const router = require('express').Router();
const path = require('path');
const multer = require('multer');
const rateLimit = require('express-rate-limit');
const db = require('../db');
const taDb = require('../taReadinessDb');
const engine = require('../services/taReview');
const { asyncHandler } = require('../middleware/errorHandler');
const { authRequired } = require('./auth');
const appState = require('../shared/appState');

const MAX_FILE_BYTES = 30 * 1024 * 1024;
const ALLOWED_EXT = ['.pdf', '.png', '.jpg', '.jpeg', '.gif', '.webp', '.xlsx', '.xls', '.xlsm', '.csv', '.docx', '.txt', '.md', '.json', '.xml'];
const EX_STATES = ['open', 'confirmed', 'dismissed', 'resolved'];

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_FILE_BYTES, files: 50 },
  fileFilter: (req, file, cb) => cb(null, ALLOWED_EXT.includes(path.extname(file.originalname).toLowerCase())),
});

// Each review is a paid model call; keep a single user from firing them in a loop.
const reviewLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, max: 30,
  keyGenerator: (req) => req.user.username, // runs after authRequired
  message: { error: 'Too many AI reviews this hour. Try again later.' },
});

const running = new Set();

function logAction(req, action, details) {
  const username = req.user ? req.user.username : 'unknown';
  db.addAuditLog(action, username, req.ip, details).catch(() => {});
}

// Superadmins see every app; everyone else needs TA Readiness AI in their allowed apps.
const appAccess = asyncHandler(async (req, res, next) => {
  if (req.user.role === 'superadmin') return next();
  const appId = await taDb.getAppId();
  const record = appState.getUsers().find(u => u.username.toLowerCase() === req.user.username.toLowerCase());
  const allowed = record ? (record.allowedApps || []) : [];
  if (appId && allowed.includes(appId)) return next();
  res.status(403).json({ error: 'No access to TA Readiness AI' });
});

const isAdmin = (req) => req.user.role === 'admin' || req.user.role === 'superadmin';
const view = (p) => ({ ...p, status: engine.statusOf(p) });
const pkgId = (req) => parseInt(req.params.id, 10);

async function loadPkg(req, res) {
  const p = await taDb.getPackage(pkgId(req));
  if (!p) res.status(404).json({ error: 'Package not found' });
  return p;
}

// ------------------------------------------------------------------ page

router.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'readiness', 'index.html'));
});

const api = require('express').Router();
api.use(authRequired, appAccess);

api.get('/health', (req, res) => {
  res.json({ ok: true, hasKey: engine.hasKey(), model: engine.MODEL, user: { username: req.user.username, role: req.user.role } });
});

// ------------------------------------------------------------------ packages

api.get('/packages', asyncHandler(async (req, res) => {
  res.json((await taDb.listPackages()).map(view));
}));

api.get('/packages/:id', asyncHandler(async (req, res) => {
  const p = await loadPkg(req, res);
  if (p) res.json(view(p));
}));

api.post('/packages', asyncHandler(async (req, res) => {
  const p = await taDb.createPackage({}, req.user.username);
  logAction(req, 'ta_package_create', { packageId: p.id });
  res.status(201).json(view(p));
}));

api.patch('/packages/:id', asyncHandler(async (req, res) => {
  const p = await loadPkg(req, res);
  if (!p) return;
  const b = req.body || {};
  const patch = {};
  const edited = new Set(p.edited);
  engine.META_FIELDS.forEach(k => {
    if (b[k] === undefined) return;
    const v = String(b[k]).trim().slice(0, k === 'title' || k === 'equipment' ? 500 : 255);
    patch[k] = v || (k === 'title' ? 'New package' : '');
    edited.add(k);
  });
  patch.edited = Array.from(edited);
  res.json(view(await taDb.updatePackage(p.id, patch)));
}));

api.delete('/packages/:id', asyncHandler(async (req, res) => {
  const p = await loadPkg(req, res);
  if (!p) return;
  if (!isAdmin(req) && p.createdBy.toLowerCase() !== req.user.username.toLowerCase()) {
    return res.status(403).json({ error: 'Only the creator or an admin can delete a package' });
  }
  if (running.has(p.id)) return res.status(409).json({ error: 'Wait for the AI review to finish before deleting' });
  await taDb.deletePackage(p.id);
  logAction(req, 'ta_package_delete', { packageId: p.id, title: p.title });
  res.json({ ok: true });
}));

// ------------------------------------------------------------------ documents

api.post('/packages/:id/documents', asyncHandler(async (req, res, next) => {
  const p = await loadPkg(req, res);
  if (!p) return;
  upload.array('files', 50)(req, res, async (err) => {
    try {
      if (err) {
        const msg = err.code === 'LIMIT_FILE_SIZE' ? 'A file is larger than 30 MB.' : err.message;
        return res.status(err.code === 'LIMIT_FILE_SIZE' ? 413 : 400).json({ error: msg });
      }
      const files = req.files || [];
      for (const f of files) {
        await taDb.addDocument(p.id, {
          name: f.originalname.slice(0, 500),
          mime: f.mimetype,
          size: f.size,
          data: f.buffer,
          extractedText: await engine.extractText(f.originalname, f.buffer),
        }, req.user.username);
      }
      // New documents make an existing review stale.
      const updated = files.length && p.review ? await taDb.updatePackage(p.id, { reviewStale: true }) : await taDb.getPackage(p.id);
      logAction(req, 'ta_documents_upload', { packageId: p.id, files: files.map(f => f.originalname) });
      res.json(view(updated));
    } catch (e) {
      next(e);
    }
  });
}));

api.get('/packages/:id/documents/:docId/file', asyncHandler(async (req, res) => {
  const d = await taDb.getDocument(pkgId(req), parseInt(req.params.docId, 10));
  if (!d) return res.status(404).json({ error: 'Document not found' });
  res.setHeader('Content-Type', d.mime || 'application/octet-stream');
  res.setHeader('Content-Disposition', `inline; filename*=UTF-8''${encodeURIComponent(d.name)}`);
  res.send(d.data);
}));

api.delete('/packages/:id/documents/:docId', asyncHandler(async (req, res) => {
  const p = await loadPkg(req, res);
  if (!p) return;
  if (running.has(p.id)) return res.status(409).json({ error: 'Wait for the AI review to finish' });
  await taDb.deleteDocument(p.id, parseInt(req.params.docId, 10));
  const updated = p.review ? await taDb.updatePackage(p.id, { reviewStale: true }) : await taDb.getPackage(p.id);
  res.json(view(updated));
}));

// ------------------------------------------------------------------ review

api.post('/packages/:id/review', reviewLimiter, asyncHandler(async (req, res) => {
  const p = await loadPkg(req, res);
  if (!p) return;
  if (!engine.hasKey()) return res.status(400).json({ error: 'The AI key is not configured on the server (ANTHROPIC_API_KEY).' });
  if (!p.documents.length) return res.status(400).json({ error: 'Upload documents first.' });
  if (running.has(p.id)) return res.status(409).json({ error: 'Review already running.' });

  running.add(p.id);
  const started = await taDb.updatePackage(p.id, { reviewStatus: 'reviewing', reviewStartedAt: new Date(), reviewError: '' });
  logAction(req, 'ta_review_start', { packageId: p.id });
  res.status(202).json(view(started));

  (async () => {
    try {
      const docs = await taDb.getDocumentsWithData(p.id);
      const { review, exceptions } = await engine.runReview(started, docs);
      const current = await taDb.getPackage(p.id);
      if (!current) return; // deleted meanwhile
      await taDb.updatePackage(p.id, {
        ...engine.extractedInfoPatch(current, review.package_info),
        review, exceptions,
        reviewStatus: 'done', reviewStale: false,
        approved: false, approvedBy: '', approvedAt: null,
      });
    } catch (err) {
      console.error(`[ta-review ${p.id}]`, err);
      await taDb.updatePackage(p.id, { reviewStatus: 'error', reviewError: engine.apiError(err) }).catch(() => {});
    } finally {
      running.delete(p.id);
    }
  })();
}));

api.patch('/packages/:id/exceptions/:exId', asyncHandler(async (req, res) => {
  const p = await loadPkg(req, res);
  if (!p) return;
  const { state, note } = req.body || {};
  if (!EX_STATES.includes(state)) return res.status(400).json({ error: 'Bad state' });
  const exceptions = p.exceptions.map(e => (e.id !== req.params.exId ? e : {
    ...e,
    state,
    verifiedBy: state === 'open' ? '' : req.user.username,
    note: note != null ? String(note).slice(0, 2000) : e.note,
    updatedAt: new Date().toISOString(),
  }));
  if (!exceptions.some(e => e.id === req.params.exId)) return res.status(404).json({ error: 'Finding not found' });
  const patch = { exceptions };
  if (engine.statusOf({ ...p, exceptions }) !== 'ready') Object.assign(patch, { approved: false, approvedBy: '', approvedAt: null });
  logAction(req, 'ta_finding_update', { packageId: p.id, finding: req.params.exId, state });
  res.json(view(await taDb.updatePackage(p.id, patch)));
}));

api.post('/packages/:id/approve', asyncHandler(async (req, res) => {
  const p = await loadPkg(req, res);
  if (!p) return;
  if (engine.statusOf(p) !== 'ready') return res.status(400).json({ error: 'Only Ready packages can be approved.' });
  logAction(req, 'ta_package_approve', { packageId: p.id });
  res.json(view(await taDb.updatePackage(p.id, { approved: true, approvedBy: req.user.username, approvedAt: new Date() })));
}));

// ------------------------------------------------------------------ agent

api.post('/ask', reviewLimiter, asyncHandler(async (req, res) => {
  const q = String((req.body && req.body.question) || '').trim().slice(0, 1000);
  if (!q) return res.status(400).json({ error: 'Ask a question.' });
  if (!engine.hasKey()) return res.status(400).json({ error: 'The AI key is not configured on the server.' });
  const register = (await taDb.listPackages()).map(p => ({
    id: p.id, number: p.number, title: p.title, unit: p.unit, system: p.system, equipment: p.equipment,
    planner: p.planner, inspector: p.inspector, status: engine.statusOf(p), approved: p.approved,
    documents: p.documents.length,
    exceptions: p.exceptions.map(e => ({ severity: e.severity, discipline: e.discipline, title: e.title, state: e.state, owner: e.owner })),
  }));
  try {
    res.json({ answer: await engine.ask(q, register) });
  } catch (err) {
    console.error('[ta-ask]', err);
    res.status(502).json({ error: engine.apiError(err) });
  }
}));

router.use('/api', api);

module.exports = router;
