const router = require('express').Router();
const path = require('path');
const db = require('../db');
const { asyncHandler } = require('../middleware/errorHandler');
const { authRequired, superAdminRequired } = require('./auth');

// ===== PAGE ROUTES =====
router.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'safety', 'index.html'));
});

router.get('/form', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'safety', 'form.html'));
});

router.get('/records', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'safety', 'records.html'));
});

// Serve individual form pages
const FORM_PAGES = ['harness', 'vehicle', 'observation', 'trailer', 'witness', 'ladder', 'incident', 'workplace', 'meeting'];
FORM_PAGES.forEach(page => {
  router.get('/' + page, (req, res) => {
    res.sendFile(path.join(__dirname, '..', 'public', 'safety', page + '.html'));
  });
});

// ===== GENERIC FORM API =====

// Save a form record (any type)
router.post('/api/forms/:formType/save', authRequired, asyncHandler(async (req, res) => {
  const formType = req.params.formType;
  const form = db.getFormType(formType);
  if (!form) return res.status(400).json({ error: 'Invalid form type' });

  const { siteName, descriptionOfWork, pdfBase64 } = req.body;
  if (!pdfBase64 || !siteName) {
    return res.status(400).json({ error: 'Missing required fields: siteName and pdfBase64' });
  }
  const pdfBuffer = Buffer.from(pdfBase64, 'base64');
  const record = await db.saveFormRecord(formType, siteName, descriptionOfWork, pdfBuffer);
  console.log(`${form.prefix} saved: ID=${record.id}, Site="${record.siteName}", Size=${record.fileSize} bytes`);
  res.json({
    success: true,
    record: {
      id: record.id,
      siteName: record.siteName,
      savedAt: record.savedAt,
      fileSize: record.fileSize
    }
  });
}));

// List records for a form type
router.get('/api/forms/:formType/records', authRequired, asyncHandler(async (req, res) => {
  const formType = req.params.formType;
  if (!db.getFormType(formType)) return res.status(400).json({ error: 'Invalid form type' });
  const records = await db.getFormRecords(formType);
  res.json(records);
}));

// Download a PDF by ID
router.get('/api/forms/:formType/records/:id/pdf', authRequired, asyncHandler(async (req, res) => {
  const formType = req.params.formType;
  const form = db.getFormType(formType);
  if (!form) return res.status(400).json({ error: 'Invalid form type' });

  const row = await db.getFormRecordPdf(formType, req.params.id);
  if (!row) return res.status(404).json({ error: 'Record not found' });

  const dateStr = new Date(row.savedAt).toISOString().slice(0, 10);
  const filename = `${row.prefix}_${row.siteName.replace(/[^a-zA-Z0-9]/g, '_')}_${dateStr}.pdf`;
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.send(row.pdfData);
}));

// Delete a single form record (super admin only)
router.delete('/api/forms/:formType/records/:id', authRequired, superAdminRequired, asyncHandler(async (req, res) => {
  const formType = req.params.formType;
  if (!db.getFormType(formType)) return res.status(400).json({ error: 'Invalid form type' });

  const deleted = await db.deleteFormRecord(formType, req.params.id);
  if (!deleted) return res.status(404).json({ error: 'Record not found' });
  console.log(`${formType.toUpperCase()} deleted: ID=${req.params.id} by ${req.user.username}`);
  res.json({ success: true });
}));

// Bulk delete records (super admin only)
router.post('/api/forms/:formType/delete', authRequired, superAdminRequired, asyncHandler(async (req, res) => {
  const formType = req.params.formType;
  if (!db.getFormType(formType)) return res.status(400).json({ error: 'Invalid form type' });

  const { ids } = req.body;
  if (!Array.isArray(ids) || ids.length === 0) {
    return res.status(400).json({ error: 'No record IDs provided' });
  }

  const deleted = await db.bulkDeleteFormRecords(formType, ids);
  console.log(`ADMIN DELETE: ${deleted} records from ${formType} by ${req.user.username}`);
  res.json({ success: true, deleted });
}));

// Get all form types
router.get('/api/form-types', authRequired, (req, res) => {
  const types = Object.entries(db.SAFETY_FORM_TYPES).map(([key, val]) => ({
    key,
    label: val.label,
    prefix: val.prefix
  }));
  res.json(types);
});

// Get record counts for all form types
router.get('/api/forms/stats', authRequired, asyncHandler(async (req, res) => {
  const stats = await db.getFormStats();
  res.json(stats);
}));

// API: Get current user info (for role check)
router.get('/api/me', authRequired, (req, res) => {
  res.json({ username: req.user.username, role: req.user.role });
});

// ===== BACKWARD COMPATIBILITY (keep old JSA endpoints working) =====
router.post('/api/save-jsa', authRequired, asyncHandler(async (req, res) => {
  const { siteName, descriptionOfWork, pdfBase64 } = req.body;
  if (!pdfBase64 || !siteName) {
    return res.status(400).json({ error: 'Missing required fields: siteName and pdfBase64' });
  }
  const pdfBuffer = Buffer.from(pdfBase64, 'base64');
  const record = await db.saveJsaRecord(siteName, descriptionOfWork, pdfBuffer);
  console.log(`JSA saved: ID=${record.id}, Site="${record.siteName}", Date=${record.savedAt}, Size=${record.fileSize} bytes`);
  res.json({
    success: true,
    record: {
      id: record.id,
      siteName: record.siteName,
      savedAt: record.savedAt,
      fileSize: record.fileSize
    }
  });
}));

router.get('/api/jsa-records', authRequired, asyncHandler(async (req, res) => {
  const records = await db.getJsaRecords();
  res.json(records.map(r => ({
    id: r.id,
    site_name: r.siteName,
    description_of_work: r.descriptionOfWork,
    saved_at: r.savedAt,
    file_size: r.fileSize
  })));
}));

router.get('/api/jsa-records/:id/pdf', authRequired, asyncHandler(async (req, res) => {
  const row = await db.getJsaRecordPdf(req.params.id);
  if (!row) {
    return res.status(404).json({ error: 'Record not found' });
  }
  const dateStr = new Date(row.savedAt).toISOString().slice(0, 10);
  const filename = `JSA_${row.siteName.replace(/[^a-zA-Z0-9]/g, '_')}_${dateStr}.pdf`;
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.send(row.pdfData);
}));

router.delete('/api/jsa-records/:id', authRequired, superAdminRequired, asyncHandler(async (req, res) => {
  const deleted = await db.deleteJsaRecord(req.params.id);
  if (!deleted) {
    return res.status(404).json({ error: 'Record not found' });
  }
  console.log(`JSA deleted: ID=${req.params.id} by ${req.user.username}`);
  res.json({ success: true });
}));

module.exports = router;
