const router = require('express').Router();
const path = require('path');
const db = require('../db');
const { asyncHandler } = require('../middleware/errorHandler');

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
router.post('/api/save-jsa', asyncHandler(async (req, res) => {
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
router.get('/api/jsa-records', asyncHandler(async (req, res) => {
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
router.get('/api/jsa-records/:id/pdf', asyncHandler(async (req, res) => {
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

module.exports = router;
