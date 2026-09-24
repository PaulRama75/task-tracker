// TA Readiness AI — packages, documents and review results.
// Kept apart from db.js; uses the same pool. Documents live in the DB (BYTEA)
// so nothing is lost when the app container restarts.
const { pool } = require('./db');

const APP_NAME = 'TA Readiness AI';

async function init() {
  const client = await pool.connect();
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS ta_packages (
        id SERIAL PRIMARY KEY,
        title VARCHAR(500) NOT NULL DEFAULT 'New package',
        number VARCHAR(255) DEFAULT '',
        unit VARCHAR(255) DEFAULT '',
        system VARCHAR(255) DEFAULT '',
        equipment VARCHAR(500) DEFAULT '',
        planner VARCHAR(255) DEFAULT '',
        inspector VARCHAR(255) DEFAULT '',
        edited_fields TEXT[] DEFAULT '{}',
        meta_from_ai BOOLEAN DEFAULT false,
        review_status VARCHAR(20) DEFAULT 'idle',
        review_started_at TIMESTAMPTZ,
        review_error TEXT DEFAULT '',
        review_stale BOOLEAN DEFAULT false,
        review JSONB,
        exceptions JSONB DEFAULT '[]'::jsonb,
        approved BOOLEAN DEFAULT false,
        approved_by VARCHAR(255) DEFAULT '',
        approved_at TIMESTAMPTZ,
        created_by VARCHAR(255) DEFAULT '',
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);
    await client.query(`
      CREATE TABLE IF NOT EXISTS ta_documents (
        id SERIAL PRIMARY KEY,
        package_id INTEGER NOT NULL REFERENCES ta_packages(id) ON DELETE CASCADE,
        name VARCHAR(500) NOT NULL,
        mime VARCHAR(255) DEFAULT '',
        size INTEGER DEFAULT 0,
        data BYTEA NOT NULL,
        extracted_text TEXT,
        uploaded_by VARCHAR(255) DEFAULT '',
        uploaded_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);
    await client.query('CREATE INDEX IF NOT EXISTS ta_documents_package_idx ON ta_documents(package_id)');

    // A review running when the server stopped will never finish.
    await client.query(`UPDATE ta_packages SET review_status='error', review_error='Server restarted during review — run it again.' WHERE review_status='reviewing'`);

    // Launcher entry (not built-in, so it is assigned per user like Reports).
    const existing = await client.query('SELECT id FROM apps WHERE LOWER(name)=LOWER($1)', [APP_NAME]);
    if (!existing.rows.length) {
      const next = await client.query('SELECT COALESCE(MAX(sort_order), 0) + 1 AS next FROM apps');
      await client.query('INSERT INTO apps (name, icon, sort_order, is_builtin) VALUES ($1, $2, $3, false)', [APP_NAME, 'ai', next.rows[0].next]);
    }
  } finally {
    client.release();
  }
}

async function getAppId() {
  const { rows } = await pool.query('SELECT id FROM apps WHERE LOWER(name)=LOWER($1)', [APP_NAME]);
  return rows.length ? rows[0].id : null;
}

const PKG_COLS = `p.id, p.title, p.number, p.unit, p.system, p.equipment, p.planner, p.inspector,
  p.edited_fields, p.meta_from_ai, p.review_status, p.review_started_at, p.review_error, p.review_stale,
  p.review, p.exceptions, p.approved, p.approved_by, p.approved_at, p.created_by, p.created_at, p.updated_at`;

function mapPkg(r, docs) {
  return {
    id: r.id,
    title: r.title,
    number: r.number || '',
    unit: r.unit || '',
    system: r.system || '',
    equipment: r.equipment || '',
    planner: r.planner || '',
    inspector: r.inspector || '',
    edited: r.edited_fields || [],
    metaFromAi: r.meta_from_ai,
    reviewStatus: r.review_status,
    reviewStartedAt: r.review_started_at,
    reviewError: r.review_error || '',
    reviewStale: r.review_stale,
    review: r.review,
    exceptions: r.exceptions || [],
    approved: r.approved,
    approvedBy: r.approved_by || '',
    approvedAt: r.approved_at,
    createdBy: r.created_by || '',
    createdAt: r.created_at,
    documents: docs || [],
  };
}

async function docsFor(ids) {
  if (!ids.length) return {};
  const { rows } = await pool.query(
    'SELECT id, package_id, name, size, uploaded_at FROM ta_documents WHERE package_id = ANY($1) ORDER BY id',
    [ids]
  );
  const by = {};
  rows.forEach(d => (by[d.package_id] = by[d.package_id] || []).push({ id: d.id, name: d.name, size: d.size, uploadedAt: d.uploaded_at }));
  return by;
}

async function listPackages() {
  const { rows } = await pool.query(`SELECT ${PKG_COLS} FROM ta_packages p ORDER BY p.created_at DESC`);
  const docs = await docsFor(rows.map(r => r.id));
  return rows.map(r => mapPkg(r, docs[r.id]));
}

async function getPackage(id) {
  const { rows } = await pool.query(`SELECT ${PKG_COLS} FROM ta_packages p WHERE p.id=$1`, [id]);
  if (!rows.length) return null;
  const docs = await docsFor([id]);
  return mapPkg(rows[0], docs[id]);
}

async function createPackage(fields, user) {
  const { rows } = await pool.query(
    `INSERT INTO ta_packages (title, number, unit, system, equipment, planner, inspector, edited_fields, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id`,
    [fields.title || 'New package', fields.number || '', fields.unit || '', fields.system || '', fields.equipment || '',
      fields.planner || '', fields.inspector || '', fields.edited || [], user || '']
  );
  return getPackage(rows[0].id);
}

// Only whitelisted columns can be updated.
const UPDATABLE = {
  title: 'title', number: 'number', unit: 'unit', system: 'system', equipment: 'equipment', planner: 'planner', inspector: 'inspector',
  edited: 'edited_fields', metaFromAi: 'meta_from_ai', reviewStatus: 'review_status', reviewStartedAt: 'review_started_at',
  reviewError: 'review_error', reviewStale: 'review_stale', review: 'review', exceptions: 'exceptions',
  approved: 'approved', approvedBy: 'approved_by', approvedAt: 'approved_at',
};
const JSON_COLS = new Set(['review', 'exceptions']);

async function updatePackage(id, fields) {
  const sets = [];
  const vals = [];
  Object.keys(fields).forEach(k => {
    const col = UPDATABLE[k];
    if (!col) return;
    vals.push(JSON_COLS.has(col) && fields[k] != null ? JSON.stringify(fields[k]) : fields[k]);
    sets.push(`${col}=$${vals.length}`);
  });
  if (!sets.length) return getPackage(id);
  vals.push(id);
  await pool.query(`UPDATE ta_packages SET ${sets.join(', ')}, updated_at=NOW() WHERE id=$${vals.length}`, vals);
  return getPackage(id);
}

async function deletePackage(id) {
  await pool.query('DELETE FROM ta_packages WHERE id=$1', [id]);
}

async function addDocument(packageId, doc, user) {
  await pool.query(
    'INSERT INTO ta_documents (package_id, name, mime, size, data, extracted_text, uploaded_by) VALUES ($1,$2,$3,$4,$5,$6,$7)',
    [packageId, doc.name, doc.mime || '', doc.size || 0, doc.data, doc.extractedText || null, user || '']
  );
}

async function getDocument(packageId, docId) {
  const { rows } = await pool.query('SELECT id, name, mime, size, data FROM ta_documents WHERE id=$1 AND package_id=$2', [docId, packageId]);
  return rows[0] || null;
}

async function getDocumentsWithData(packageId) {
  const { rows } = await pool.query('SELECT id, name, mime, size, data, extracted_text FROM ta_documents WHERE package_id=$1 ORDER BY id', [packageId]);
  return rows;
}

async function deleteDocument(packageId, docId) {
  const r = await pool.query('DELETE FROM ta_documents WHERE id=$1 AND package_id=$2', [docId, packageId]);
  return r.rowCount > 0;
}

module.exports = {
  APP_NAME, init, getAppId,
  listPackages, getPackage, createPackage, updatePackage, deletePackage,
  addDocument, getDocument, getDocumentsWithData, deleteDocument,
};
