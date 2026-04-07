const router = require('express').Router();
const path = require('path');
const db = require('../db');
const { asyncHandler } = require('../middleware/errorHandler');
const { authRequired, superAdminRequired } = require('./auth');

// Serve safety pages
router.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'safety', 'index.html'));
});

router.get('/form', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'safety', 'form.html'));
});

router.get('/records', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'safety', 'records.html'));
});

// API: Save JSA PDF record
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

// API: List all saved JSA records
router.get('/api/jsa-records', authRequired, asyncHandler(async (req, res) => {
  // Return plain array with snake_case keys for frontend compatibility
  const records = await db.getJsaRecords();
  res.json(records.map(r => ({
    id: r.id,
    site_name: r.siteName,
    description_of_work: r.descriptionOfWork,
    saved_at: r.savedAt,
    file_size: r.fileSize
  })));
}));

// API: Download a saved JSA PDF by ID
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

// API: Get current user info (for role check)
router.get('/api/me', authRequired, (req, res) => {
  res.json({ username: req.user.username, role: req.user.role });
});

// API: Delete a JSA record (super admin only)
router.delete('/api/jsa-records/:id', authRequired, superAdminRequired, asyncHandler(async (req, res) => {
  const deleted = await db.deleteJsaRecord(req.params.id);
  if (!deleted) {
    return res.status(404).json({ error: 'Record not found' });
  }
  console.log(`JSA deleted: ID=${req.params.id} by ${req.user.username}`);
  res.json({ success: true });
}));

module.exports = router;
