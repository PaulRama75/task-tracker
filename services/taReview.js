// TA Readiness AI — review engine.
// Sends a package's documents to Claude, which cross-checks them against each other,
// then turns every unresolved traceability line into a finding.
const path = require('path');
const XLSX = require('xlsx');
const mammoth = require('mammoth');
const Anthropic = require('@anthropic-ai/sdk').default;
const prep = require('./taDocPrep');

const MODEL = process.env.CLAUDE_MODEL || 'claude-opus-5';
const MAX_REQUEST_BYTES = 30 * 1024 * 1024; // API request cap is 32 MB

const CHECKS = [
  'scope_match', 'pid_connections', 'jobplan', 'drawing', 'bom', 'wps', 'welders', 'nde', 'ptest',
  'flange', 'refractory', 'coating', 'itp', 'assign', 'approvals',
];
const DISCIPLINES = [
  'Mechanical', 'Piping', 'Fixed Equipment', 'NDE', 'Welding', 'Materials',
  'Flange Management', 'Refractory', 'Coating', 'Operations',
];
const DOC_TYPES = [
  'work_package', 'job_plan', 'ifc_drawing', 'isometric', 'bom', 'material_spec',
  'wps', 'pqr', 'welder_qualification', 'inspection_plan', 'itp', 'nde_request',
  'nde_procedure', 'pressure_test', 'flange_log', 'refractory', 'coating',
  'equipment_data', 'qaqc_form', 'approval', 'other',
];

const obj = (properties) => ({
  type: 'object',
  additionalProperties: false,
  required: Object.keys(properties),
  properties,
});
const str = { type: 'string' };

const META_FIELDS = ['title', 'number', 'unit', 'system', 'equipment', 'planner', 'inspector'];

const REVIEW_SCHEMA = obj({
  package_info: obj({
    title: str,
    number: str,
    unit: str,
    system: str,
    equipment: str,
    planner: str,
    inspector: str,
  }),
  package_summary: str,
  connection_register: obj({
    equipment: str,
    documents_used: str,
    connections: {
      type: 'array',
      items: obj({
        connection: str,
        description: str,
        pid_size: str,
        mdr_size: str,
        construction_size: str,
        iso_size: str,
        bom_size: str,
        blind_list_size: str,
        status: { type: 'string', enum: ['match', 'size_mismatch', 'not_on_blind_list', 'not_in_bom', 'not_in_mdr', 'no_isolation_needed'] },
        source_location: str,
        comment: str,
      }),
    },
  }),
  flange_register: obj({
    documents_used: str,
    items: {
      type: 'array',
      items: obj({
        bom_item: str,
        description: str,
        bom_size: str,
        bom_qty: str,
        pid: str,
        mdr: str,
        construction: str,
        iso: str,
        required_qty: str,
        status: { type: 'string', enum: ['match', 'size_mismatch', 'rating_mismatch', 'qty_mismatch', 'not_on_drawings'] },
        comment: str,
      }),
    },
  }),
  task_traceability: obj({
    plan_items: {
      type: 'array',
      items: obj({
        item: str,
        item_type: { type: 'string', enum: ['inspection_plan', 'recommendation', 'scope'] },
        source_file: str,
        source_location: str,
        status: { type: 'string', enum: ['matched', 'partial', 'missing', 'referenced_elsewhere', 'not_a_task'] },
        operations: str,
        comment: str,
      }),
    },
    unmatched_operations: {
      type: 'array',
      items: obj({ operation: str, description: str, work_center: str, source_location: str, comment: str }),
    },
    wo_references: {
      type: 'array',
      items: obj({
        wo_number: str,
        source_location: str,
        context: str,
        status: { type: 'string', enum: ['this_package', 'included', 'not_in_package'] },
        severity: { type: 'string', enum: ['critical', 'warning'] },
        comment: str,
      }),
    },
    equipment_mismatch: { type: 'boolean' },
    equipment_consistency: str,
    duration_consistency: str,
  }),
  scope_requirements: {
    type: 'array',
    items: obj({ requirement: str, source_file: str, source_location: str }),
  },
  documents: {
    type: 'array',
    items: obj({
      file_name: str,
      document_type: str,
      identifier: str,
      revision: str,
      notes: str,
    }),
  },
  checks: {
    type: 'array',
    items: obj({
      check: str,
      status: { type: 'string', enum: ['ok', 'warning', 'critical', 'not_applicable', 'insufficient_info'] },
      finding: str,
    }),
  },
  exceptions: {
    type: 'array',
    items: obj({
      severity: { type: 'string', enum: ['critical', 'warning'] },
      discipline: str,
      check: str,
      title: str,
      detail: str,
      evidence: {
        type: 'array',
        items: obj({ file_name: str, location: str, quote: str }),
      },
      basis_type: { type: 'string', enum: ['package', 'code'] },
      basis: str,
      recommended_action: str,
      owner: str,
    }),
  },
});

const SYSTEM_PROMPT = `You review one turnaround (TA) work package for readiness. You receive every document in the package. Your job is not to summarize: it is to COMPARE THE DOCUMENTS IN THIS PACKAGE AGAINST EACH OTHER and report where they disagree or where something one document requires or references is not found in the others.

SOURCE RULES — every exception has a "basis_type":
- "package" (the default and the main job): the requirement comes from a package document and the conflict or absence is in the other package documents. TASKS, WORK ORDER REFERENCES, BOM / MATERIALS, QUANTITIES, REVISIONS, EQUIPMENT TAGS and DOCUMENT REFERENCES are ALWAYS compared within the package only: e.g. BOM vs the materials on the drawings / specs / job plan in the package, job plan operations vs the inspection plan and IWRs in the package. Never use outside assumptions (typical materials, "should be" lists) for these. "basis" names the package document and location (e.g. "Inspection Plan, p.2: 'Gather UT's at all predetermined locations'").
- "code": a technical adequacy finding against an external code or standard (ASME B31.3, ASME VIII / IX, ASME PCC-1/PCC-2, API 510/570/653, NBIC, etc.), e.g. a stated test pressure, NDE extent, PWHT or inspection interval that does not satisfy the code named in or applicable to the package. Only when you are confident the code applies; "basis" cites the code and paragraph. Evidence still quotes the package value being judged. Never use a code to invent a task, material or document the package does not mention.

Prepared inputs (the system adds these next to the original files; use them):
- "<file> — text layer (exact characters)": the PDF's own text, rebuilt into lines, " | " marks a column gap. Take numbers, sizes, ratings, quantities, tags, revisions and hours from here when present: it is exact, the page image is not.
- "Job plan operations (parsed)": every SAP / work-order operation line found in the package, parsed by code. Treat it as the complete operation list for task traceability and unmatched operations — account for every row.
- "<file>, page N — zoomed tile …": high-resolution crops of large drawing pages (P&ID, ISO, GA / construction drawing, MDR). Read line sizes, nozzle marks, flange ratings and joint tags from the tiles; the tile label says where on the page it sits, and neighbouring tiles overlap.
- Scanned pages have no text layer; read those from the page image and tiles, and say "unreadable" rather than guess.

How to work:
1. Read the cover sheet / work package / job plan / inspection plan first and list what they require (scope, tasks, recommendations / IWRs, equipment tags, work order numbers, revisions, materials, NDE, tests, hold points, forms, approvals, durations).
2. For each requirement, look for it in the other documents and check they agree: same equipment tag and work order everywhere; drawing revisions vs revisions referenced elsewhere; BOM vs materials stated on drawings or specs in the package; WPS / welder records vs what the package says is needed; NDE request vs NDE stated in the inspection plan; test package vs test stated in the job plan; flanged joints on drawings vs flange log and gasket/stud quantities; hold points vs forms and assignments; required signatures vs signed.
3. TASK TRACEABILITY (check "scope_match", fill "task_traceability"): list every bullet of the Inspection Plan and every Recommendation / IWR / scope item as a separate plan item, worded as in the document. For each, find the job plan / work order operations that carry it out and write them in "operations" as one line per operation: "0110 DO API 510 ON INTERNAL/EXT OF 004-0038 (TAQA, 2.0 HR)"; empty string when none. "source_location" should include the file name when the package has several files.
   - matched: an operation clearly performs it. partial: only part of it is covered (e.g. removal but no replacement, inspection but no UT). missing: no operation does it. referenced_elsewhere: the operation only says "refer to W.O. …" or similar. not_a_task: an informational statement that asks for no work (e.g. "Vessel inspection history is based on mechanical inspection records", "No anticipated repairs") — list it but it needs no operation.
   - "unmatched_operations": every job plan operation whose task is not asked for by any inspection plan item, recommendation / IWR or scope item. Support work (scaffold, blinds, open/close manways, cleaning, ventilation, staging) counts as captured when it enables a plan item. Include source file and location.
   - "wo_references": EVERY work order / W.O. / notification number that appears anywhere in the package (cover sheet, headers, operation descriptions such as "REFER TO W.O. 40132886", notes, recommendations). One entry per number per place it appears. status "this_package" for the package's own work order, "included" when that work order's job plan / scope is also in the package, otherwise "not_in_package". severity "critical" when the package shows that work order carries work the inspection plan or IWRs depend on, otherwise "warning". In "context" quote the operation or sentence.
   - "equipment_mismatch": true when any operation, form or drawing names a different equipment tag or work order than the package cover / inspection plan.
   - "equipment_consistency": state the tags / work orders found and where. "duration_consistency": compare durations stated in the package (e.g. "4 hours required for inspection and NDE") with the hours on the matching operations.
   - Do NOT raise exceptions for traceability yourself (the system generates them from task_traceability).
4. CONNECTION REGISTER (check "pid_connections", fill "connection_register"): for the equipment this package is for (the tag on the cover sheet / work order, e.g. 004-0030), go through the P&ID(s) in the package and list EVERY piping connection that touches that equipment: each nozzle and the line on it (line number, size, spec as written, e.g. 14"-BC-HL-585), drains, vents, relief connections, instrument / level-bridle / sample connections, utility connections. One entry per connection.
   - For each connection record the size (and rating / facing when shown, e.g. 14" 150# RF) exactly as written in each package document: "pid_size" (P&ID), "mdr_size" (MDR / vessel data sheet / nozzle schedule), "construction_size" (construction / fabrication / GA drawing), "iso_size" (isometric), "bom_size" (BOM / material list line that serves it: blind, gasket, studs), "blind_list_size" (blind list / isolation list / blinding photos). Use "" when that document type is not in the package, and "none" when the document is in the package but the connection is not on it.
   - status: match (all present sizes agree and it is covered wherever the package requires); size_mismatch (any two documents give different sizes or ratings for the same connection); not_on_blind_list (the package requires blinding/isolation for entry or the work — e.g. job plan "install blinds", ITP entry — and this connection is not on the blind list or blinding photos); not_in_bom (on the blind list but no matching blind / gasket / stud line of that size and rating in the BOM); not_in_mdr (the connection is on the P&ID but not in the MDR nozzle schedule, or vice versa); no_isolation_needed (instrument or connection the package itself says does not need a blind, e.g. isolated by a closed block valve inside the boundary) — say why in "comment".
   - Compare within the package only. Read sizes from the drawings carefully; if a size is unreadable, put "unreadable" and explain in "comment" rather than guessing.
   - "documents_used": which package files you used as the P&ID, MDR, BOM and blind list (or "not in package").
   - Do NOT raise exceptions for the connection register yourself (the system generates them).
5. FLANGE VERIFICATION — BOM to documents (check "flange", fill "flange_register"): list EVERY flange-related line on the BOM / material list (flanges, blinds, spectacle / paddle blinds, spacers, gaskets, stud-bolt sets). For each line:
   - "bom_size": size, pressure rating and facing as written on the BOM (e.g. 8" 300# RF WN); "bom_qty": BOM quantity.
   - "pid", "mdr", "construction", "iso": what that document shows for the connection(s) this BOM line serves — size / rating / facing and the connection or joint reference (e.g. "8\" 300# — N2, FJ-02") — "none" when the document is in the package but shows no matching flange, "" when that document type is not in the package.
   - "required_qty": how many the package documents require (count of joints / blind points of that size and rating across the drawings and blind list).
   - status: match; size_mismatch (a document shows a different size); rating_mismatch (same size, different pressure class or facing); qty_mismatch (BOM quantity differs from required_qty); not_on_drawings (no package drawing shows a flange of that size / rating).
   - Also make sure every flanged joint on the P&ID, MDR, construction drawing and ISO appears in "connection_register" with its sizes, so flanges missing from the BOM are caught there.
   - Compare within the package only; "unreadable" instead of guessing. Do NOT raise exceptions for the flange register yourself (the system generates them).
6. A document that the package itself references or requires (e.g. "per test package TP-…", "refer to W.O. …", "file in IDMS", an ITP named in the job plan) but that is not in the package is a finding. Documents the package never mentions are not findings.

Severity:
- critical: a code requirement is not met in a way that affects safety or integrity, or the documents conflict in a way that would stop the work or have it done wrong (different equipment / work order, planned task with no operation, material or NDE stated one way in one document and differently in another, required document named but absent).
- warning: administrative or partial conflicts (revision mismatch, quantity mismatch, missing signature the package asks for, unclear assignment).

Allowed values (use exactly these strings):
- check keys: ${CHECKS.join(', ')}
- disciplines: ${DISCIPLINES.join(', ')}
- document types: ${DOC_TYPES.join(', ')}

Rules:
- Every exception must cite evidence from the package: file name, location (page, section, table row, operation number) and a short verbatim quote. For an absence, name the document that requires it and the documents you searched.
- Do not invent document numbers, revisions or values. If something is unreadable or ambiguous, use status "insufficient_info" on the check and say what is unclear.
- Fill "checks" with one entry for every check key; use "not_applicable" when nothing in the package calls for it.
- "owner" is the role that should fix it (Planner, Welding Engineer, NDE Coordinator, Inspector, Materials Coordinator, Fixed Equipment Engineer, Operations).
- Package details ("package_info"): read them from the documents (cover sheet / job plan first). "title" is a short scope title; "number" the work order or job plan number; "unit", "system", "equipment" (tag and/or line), "planner", "inspector" as written. Empty string when not stated.
- Be concise. Use units, tags and wording exactly as written in the documents.`;

// ------------------------------------------------------------------ Claude client

let client = null;
function claude() {
  if (!client) {
    // Org-level (unscoped) keys must name the workspace to bill on every request.
    const ws = (process.env.ANTHROPIC_WORKSPACE_ID || '').trim();
    client = new Anthropic(ws ? { defaultHeaders: { 'anthropic-workspace-id': ws } } : {}); // reads ANTHROPIC_API_KEY
  }
  return client;
}
const hasKey = () => !!(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN);
const apiError = (err) => (err instanceof Anthropic.APIError ? `Claude API error ${err.status}: ${err.message}` : err.message);

// ------------------------------------------------------------------ documents

async function extractText(name, buffer) {
  if (path.extname(name).toLowerCase() !== '.docx') return null;
  try {
    return (await mammoth.extractRawText({ buffer })).value;
  } catch {
    return '';
  }
}

async function toBlocks(docs) {
  const blocks = [];
  const tileBlocks = [];
  const operations = [];
  let bytes = 0;
  const skipped = [];
  const notes = [];
  // Tiles only get the room the original files leave inside the request limit (base64 adds ~34%).
  const baseBytes = docs.reduce((a, d) => a + d.data.length * 1.34, 0);
  const budget = prep.newBudget(Math.max(0, MAX_REQUEST_BYTES - 2 * 1048576 - baseBytes));
  const addText = (title, text) => {
    bytes += text.length;
    blocks.push({ type: 'document', title, source: { type: 'text', media_type: 'text/plain', data: text } });
  };
  const addTiles = (tiles) => tiles.forEach(t => {
    bytes += t.data.length * 1.34;
    tileBlocks.push({ type: 'text', text: t.label });
    tileBlocks.push({ type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: t.data.toString('base64') } });
  });

  for (const doc of docs) {
    const buf = doc.data;
    const ext = path.extname(doc.name).toLowerCase();
    const title = doc.name;
    try {
      if (ext === '.pdf') {
        bytes += buf.length * 1.34;
        blocks.push({ type: 'document', title, source: { type: 'base64', media_type: 'application/pdf', data: buf.toString('base64') } });
        const r = await prep.preparePdf(title, buf, budget);
        if (r.text.trim().length > 40) addText(`${title} — text layer (exact characters)`, r.text);
        else if (!r.error) notes.push(`${title}: no text layer (scanned)`);
        if (r.error) notes.push(`${title}: text/drawing preparation failed (${r.error})`);
        r.operations.forEach(o => operations.push({ file: title, ...o }));
        addTiles(r.tiles);
        if (r.drawingPages.length) notes.push(`${title}: drawing pages ${r.drawingPages.join(', ')} zoomed`);
      } else if (['.png', '.jpg', '.jpeg', '.gif', '.webp'].includes(ext)) {
        const media = ext === '.jpg' ? 'image/jpeg' : `image/${ext.slice(1)}`;
        bytes += buf.length * 1.34;
        blocks.push({ type: 'text', text: `Image file: ${title}` });
        blocks.push({ type: 'image', source: { type: 'base64', media_type: media, data: buf.toString('base64') } });
        addTiles(await prep.prepareImage(title, buf, budget));
      } else if (['.xlsx', '.xls', '.xlsm', '.csv'].includes(ext)) {
        const wb = XLSX.read(buf, { type: 'buffer' });
        const text = wb.SheetNames.map(n => `### Sheet: ${n}\n${XLSX.utils.sheet_to_csv(wb.Sheets[n])}`).join('\n\n');
        addText(title, text || '(empty workbook)');
        prep.operationsFromText(text).forEach(o => operations.push({ file: title, ...o }));
      } else if (ext === '.docx') {
        const text = doc.extracted_text || '';
        addText(title, text || '(no text extracted)');
        prep.operationsFromText(text).forEach(o => operations.push({ file: title, ...o }));
      } else if (['.txt', '.md', '.json', '.xml'].includes(ext)) {
        const text = buf.toString('utf8');
        addText(title, text || '(empty file)');
        prep.operationsFromText(text).forEach(o => operations.push({ file: title, ...o }));
      } else {
        skipped.push(`${title} (unsupported type)`);
      }
    } catch (e) {
      skipped.push(`${title} (${e.message})`);
    }
  }

  if (operations.length) {
    const rows = operations.map(o => [o.operation, o.suboperation, o.description, o.work_center, o.work, o.people, o.duration, o.file].join(' | '));
    addText('Job plan operations (parsed)', `operation | suboperation | description | work center | work | people | duration | file\n${rows.join('\n')}`);
  }
  // Original files and exact text first, zoomed drawing tiles after them.
  return { blocks: blocks.concat(tileBlocks), bytes, skipped, notes, operationCount: operations.length, tiles: budget.tiles };
}

// ------------------------------------------------------------------ parsing

// Engineering text is full of inch marks (8" 300#). A single unescaped one breaks the whole
// reply, so a quote inside a string that is not followed by JSON punctuation is escaped.
function repairJson(t) {
  let out = '';
  let inStr = false;
  for (let k = 0; k < t.length; k++) {
    const ch = t[k];
    if (inStr) {
      if (ch === '\\') { out += ch + (t[k + 1] || ''); k++; continue; }
      if (ch === '"') {
        const rest = t.slice(k + 1).match(/^\s*(.)/);
        const next = rest ? rest[1] : '';
        if (next === ',' || next === '}' || next === ']' || next === ':' || next === '') { inStr = false; out += ch; } else out += '\\"';
        continue;
      }
      out += ch === '\n' ? '\\n' : ch === '\r' ? '' : ch === '\t' ? '\\t' : ch;
      continue;
    }
    if (ch === '"') inStr = true;
    out += ch;
  }
  return out.replace(/,\s*([}\]])/g, '$1');
}

function parseJson(text) {
  const t = String(text || '').trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '');
  const i = t.indexOf('{');
  const j = t.lastIndexOf('}');
  if (i < 0 || j <= i) return null;
  const body = t.slice(i, j + 1);
  try {
    return JSON.parse(body);
  } catch (first) {
    try {
      return JSON.parse(repairJson(body));
    } catch (second) {
      console.warn(`[ta-review] JSON parse failed: ${first.message}; after repair: ${second.message}`);
      return null;
    }
  }
}

// Enum-heavy schemas exceed the structured-output grammar limit, so the long value lists
// live in the prompt and are enforced here instead.
function normalize(result) {
  const pickFrom = (list, v, fallback) => {
    const k = String(v || '').trim().toLowerCase();
    return list.find(x => x.toLowerCase() === k) || fallback;
  };
  const arr = (v) => (Array.isArray(v) ? v : []);
  const txt = (v) => (v == null ? '' : Array.isArray(v) ? v.map(x => (typeof x === 'string' ? x : Object.values(x || {}).join(' '))).join('\n') : String(v));
  result.package_info = result.package_info || {};
  result.package_summary = txt(result.package_summary);
  ['scope_requirements', 'documents', 'checks', 'exceptions'].forEach(k => (result[k] = arr(result[k])));
  const t = (result.task_traceability = result.task_traceability || {});
  t.plan_items = arr(t.plan_items).map(i => ({ ...i, item: txt(i.item), operations: txt(i.operations), comment: txt(i.comment), status: ['matched', 'partial', 'missing', 'referenced_elsewhere', 'not_a_task'].includes(i.status) ? i.status : 'missing' }));
  t.unmatched_operations = arr(t.unmatched_operations);
  t.wo_references = arr(t.wo_references);
  t.equipment_mismatch = !!t.equipment_mismatch;
  t.equipment_consistency = txt(t.equipment_consistency);
  t.duration_consistency = txt(t.duration_consistency);
  const cr = (result.connection_register = result.connection_register || {});
  cr.equipment = txt(cr.equipment);
  cr.documents_used = txt(cr.documents_used);
  const CONN = ['match', 'size_mismatch', 'not_on_blind_list', 'not_in_bom', 'not_in_mdr', 'no_isolation_needed'];
  cr.connections = arr(cr.connections).map(c => ({
    connection: txt(c.connection), description: txt(c.description),
    pid_size: txt(c.pid_size), mdr_size: txt(c.mdr_size), construction_size: txt(c.construction_size), iso_size: txt(c.iso_size),
    bom_size: txt(c.bom_size), blind_list_size: txt(c.blind_list_size),
    status: CONN.includes(c.status) ? c.status : 'size_mismatch',
    source_location: txt(c.source_location), comment: txt(c.comment),
  }));
  const fr = (result.flange_register = result.flange_register || {});
  fr.documents_used = txt(fr.documents_used);
  const FL = ['match', 'size_mismatch', 'rating_mismatch', 'qty_mismatch', 'not_on_drawings'];
  fr.items = arr(fr.items).map(f => ({
    bom_item: txt(f.bom_item), description: txt(f.description), bom_size: txt(f.bom_size), bom_qty: txt(f.bom_qty),
    pid: txt(f.pid), mdr: txt(f.mdr), construction: txt(f.construction), iso: txt(f.iso), required_qty: txt(f.required_qty),
    status: FL.includes(f.status) ? f.status : 'size_mismatch', comment: txt(f.comment),
  }));
  result.exceptions.forEach(e => {
    e.severity = e.severity === 'critical' ? 'critical' : 'warning';
    e.evidence = arr(e.evidence);
    e.basis_type = e.basis_type === 'code' ? 'code' : 'package';
  });
  result.checks.forEach(c => (c.check = pickFrom(CHECKS, c.check, c.check)));
  (result.exceptions || []).forEach(e => {
    e.check = pickFrom(CHECKS, e.check, 'jobplan');
    e.discipline = pickFrom(DISCIPLINES, e.discipline, 'Mechanical');
  });
  (result.documents || []).forEach(d => (d.document_type = pickFrom(DOC_TYPES, d.document_type, 'other')));
}

// Every unresolved traceability line becomes a finding, so nothing referenced in the
// package can drop out silently — the model lists, the server flags.
// Every connection that does not line up across P&ID / MDR / BOM / blind list becomes a finding.
function connectionExceptions(cr) {
  if (!cr) return [];
  const RULES = {
    size_mismatch: ['critical', 'Size / rating differs between documents', 'Piping', 'Correct the document that is wrong so P&ID, MDR, BOM and blind list agree before materials are staged.'],
    not_on_blind_list: ['critical', 'Connection not on the blind list', 'Flange Management', 'Add the connection to the blind list (with blind size / rating) or record why it does not need a blind.'],
    not_in_bom: ['warning', 'Blind point has no matching BOM material', 'Materials', 'Add the blind, gasket and studs of the right size and rating to the BOM.'],
    not_in_mdr: ['warning', 'Connection missing from the MDR / nozzle schedule', 'Fixed Equipment', 'Reconcile the P&ID with the MDR / vessel data sheet.'],
  };
  const sizes = (c) => ['P&ID ' + (c.pid_size || '—'), 'MDR ' + (c.mdr_size || '—'), 'Construction ' + (c.construction_size || '—'), 'ISO ' + (c.iso_size || '—'),
    'BOM ' + (c.bom_size || '—'), 'Blind list ' + (c.blind_list_size || '—')].join(' · ');
  return (cr.connections || []).filter(c => RULES[c.status]).map(c => {
    const [severity, what, discipline, action] = RULES[c.status];
    return {
      severity, discipline, check: 'pid_connections', basis_type: 'package',
      title: `${what}: ${c.connection}${c.description ? ` (${c.description})` : ''}`,
      detail: `${sizes(c)}${c.comment ? ` — ${c.comment}` : ''}`,
      evidence: [{ file_name: '', location: c.source_location, quote: sizes(c) }],
      basis: `Package cross-reference: P&ID vs MDR vs BOM vs blind list (${cr.documents_used || 'package documents'})`,
      recommended_action: action,
      owner: 'Planner',
    };
  });
}

// Every BOM flange line that does not agree with the drawings becomes a finding.
function flangeExceptions(fr) {
  if (!fr) return [];
  const RULES = {
    size_mismatch: ['critical', 'BOM flange size differs from the drawings', 'Correct the BOM or the drawing so the flange size matches before material is ordered / staged.'],
    rating_mismatch: ['critical', 'BOM flange rating / facing differs from the drawings', 'Correct the pressure class / facing on the BOM or drawing.'],
    qty_mismatch: ['warning', 'BOM flange quantity differs from the joints on the drawings', 'Adjust the BOM quantity to the number of joints / blind points shown in the package.'],
    not_on_drawings: ['warning', 'BOM flange item not shown on any package drawing', 'Confirm where this item is used or remove it from the BOM.'],
  };
  const where = (f) => ['BOM ' + (f.bom_size || '—') + (f.bom_qty ? ' ×' + f.bom_qty : ''), 'P&ID ' + (f.pid || '—'), 'MDR ' + (f.mdr || '—'),
    'Construction ' + (f.construction || '—'), 'ISO ' + (f.iso || '—')].concat(f.required_qty ? ['required ×' + f.required_qty] : []).join(' · ');
  return (fr.items || []).filter(f => RULES[f.status]).map(f => {
    const [severity, what, action] = RULES[f.status];
    return {
      severity, discipline: 'Flange Management', check: 'flange', basis_type: 'package',
      title: `${what}: ${f.bom_item}${f.description ? ` (${f.description})` : ''}`,
      detail: `${where(f)}${f.comment ? ` — ${f.comment}` : ''}`,
      evidence: [{ file_name: '', location: 'BOM ' + f.bom_item, quote: where(f) }],
      basis: `Package cross-reference: BOM vs P&ID, MDR, construction drawing and ISO (${fr.documents_used || 'package documents'})`,
      recommended_action: action,
      owner: 'Planner',
    };
  });
}

function traceabilityExceptions(t) {
  if (!t) return [];
  const out = [];
  const ex = (severity, title, detail, evidence, action) => out.push({
    severity, discipline: 'Mechanical', check: 'scope_match', title, detail, evidence, basis_type: 'package',
    basis: 'Package cross-reference: the task / work order is stated in one package document and not carried in the others',
    recommended_action: action, owner: 'Planner',
  });

  if (t.equipment_mismatch) {
    ex('critical', 'Equipment tag / work order mismatch between documents', t.equipment_consistency, [], 'Correct the job plan operations (or package) so every document names the same equipment and work order.');
  }
  (t.plan_items || []).forEach(i => {
    if (i.status === 'matched' || i.status === 'not_a_task') return;
    const src = [{ file_name: i.source_file, location: i.source_location, quote: i.item }];
    const kind = i.item_type === 'recommendation' ? 'Recommendation / IWR' : i.item_type === 'inspection_plan' ? 'Inspection plan task' : 'Scope item';
    if (i.status === 'missing') {
      ex('critical', `${kind} not captured in job plan: ${i.item}`, i.comment || 'No job plan operation performs this task.', src, 'Add a job plan operation (work center, hours) for this task or record why it is not required.');
    } else if (i.status === 'partial') {
      ex('warning', `${kind} only partly captured: ${i.item}`, `${i.comment}${i.operations ? ` Covered by: ${i.operations}` : ''}`, src, 'Add the missing part of the task to the job plan.');
    } else {
      ex('warning', `${kind} deferred to another work order: ${i.item}`, `${i.comment}${i.operations ? ` Operations: ${i.operations}` : ''}`, src, 'Attach the referenced work order or confirm it is scheduled in the same window.');
    }
  });
  (t.unmatched_operations || []).forEach(o => {
    ex('warning', `Job plan operation not in inspection plan / IWRs: ${o.operation} ${o.description}`, o.comment || 'This operation is not asked for by any inspection plan item or recommendation.',
      [{ file_name: '', location: o.source_location || `Operation ${o.operation}`, quote: o.description }],
      'Confirm the task is required and add it to the inspection plan, or remove it from the job plan.');
  });
  const seen = new Set();
  (t.wo_references || []).forEach(w => {
    if (w.status !== 'not_in_package') return;
    const key = `${w.wo_number}|${w.context}`;
    if (seen.has(key)) return;
    seen.add(key);
    ex(w.severity || 'warning', `Referenced W.O. ${w.wo_number} not in package`, `${w.context}${w.comment ? ` — ${w.comment}` : ''}`,
      [{ file_name: '', location: w.source_location, quote: w.context }],
      `Attach W.O. ${w.wo_number} scope/job plan to this package or confirm it is planned, released and scheduled with this work.`);
  });
  return out;
}


// ------------------------------------------------------------------ review

async function runReview(pkg, docs) {
  const { blocks, bytes, skipped, notes, operationCount, tiles } = await toBlocks(docs);
  if (!blocks.length) throw new Error('No readable documents in this package.');
  if (bytes > MAX_REQUEST_BYTES) {
    throw new Error(`Package documents are ~${Math.round(bytes / 1048576)} MB; the per-review limit is ~30 MB. Split large drawing sets or remove duplicates.`);
  }

  const meta = [
    pkg.title !== 'New package' && `Work package: ${pkg.title}`,
    pkg.number && `Package number: ${pkg.number}`,
    pkg.unit && `Unit: ${pkg.unit}`,
    pkg.system && `System: ${pkg.system}`,
    pkg.equipment && `Equipment / line: ${pkg.equipment}`,
    pkg.planner && `Planner: ${pkg.planner}`,
    pkg.inspector && `Inspector: ${pkg.inspector}`,
    `Files in package (${docs.length}): ${docs.map(d => d.name).join('; ')}`,
    skipped.length && `Files that could not be read: ${skipped.join('; ')}`,
    notes.length && `Preparation notes: ${notes.join('; ')}`,
    operationCount && `Parsed job plan operations: ${operationCount}`,
  ].filter(Boolean).join('\n');

  // The review schema is too large for strict structured outputs (grammar size limit),
  // so the schema goes in the prompt and the reply is parsed and repaired here.
  const request = () => claude().beta.messages.stream({
    model: MODEL,
    max_tokens: 64000,
    betas: ['server-side-fallback-2026-07-01'],
    fallbacks: 'default',
    thinking: { type: 'adaptive' },
    output_config: { effort: 'high' },
    system: `${SYSTEM_PROMPT}\n\nOUTPUT: reply with ONE JSON object and nothing else (no prose, no code fences). It must match this JSON Schema exactly (all properties required; use "" or [] when empty):\n${JSON.stringify(REVIEW_SCHEMA)}`,
    messages: [{
      role: 'user',
      content: [
        ...blocks,
        { type: 'text', text: `${meta}\n\nCross-check every document in this package against the others and return the readiness review JSON.` },
      ],
    }],
  }).finalMessage();

  let result = null;
  let msg = null;
  for (let attempt = 1; attempt <= 2 && !result; attempt++) {
    msg = await request();
    if (msg.stop_reason === 'refusal') throw new Error('The model declined to review this package.');
    if (msg.stop_reason === 'max_tokens') throw new Error('The review was cut off (output limit). Try splitting the package.');
    result = parseJson(msg.content.filter(b => b.type === 'text').map(b => b.text).join(''));
    if (!result) console.warn(`[ta-review ${pkg.id}] unparseable reply on attempt ${attempt}`);
  }
  if (!result) throw new Error('The model returned an unreadable review twice. Run it again.');
  normalize(result);
  const exceptions = (result.exceptions || [])
    .filter(e => e.check !== 'scope_match')
    .filter(e => e.check !== 'pid_connections')
    .concat(traceabilityExceptions(result.task_traceability))
    .concat(connectionExceptions(result.connection_register))
    .concat(flangeExceptions(result.flange_register))
    .map((e, i) => ({ ...e, id: `x${i + 1}`, state: 'open', verifiedBy: '', note: '' }));
  delete result.exceptions;
  return {
    review: {
      ...result,
      skipped,
      preparation: { notes, operations: operationCount, tiles },
      model: msg.model,
      usage: { input_tokens: msg.usage.input_tokens, output_tokens: msg.usage.output_tokens },
      ranAt: new Date().toISOString(),
    },
    exceptions,
  };
}

// AI-extracted details fill every field the user has not typed in themselves.
function extractedInfoPatch(pkg, info) {
  const patch = { metaFromAi: true };
  if (!info) return patch;
  const edited = pkg.edited || [];
  META_FIELDS.forEach(k => {
    const v = String(info[k] || '').trim();
    if (v && edited.indexOf(k) < 0) patch[k] = v.slice(0, k === 'title' || k === 'equipment' ? 500 : 255);
  });
  return patch;
}

function statusOf(p) {
  if (!p.review) return 'notreviewed';
  const active = (p.exceptions || []).filter(e => e.state === 'open' || e.state === 'confirmed');
  if (active.some(e => e.severity === 'critical')) return 'notready';
  if (active.length) return 'attention';
  return 'ready';
}

// ------------------------------------------------------------------ readiness agent

async function ask(question, register) {
  const msg = await claude().beta.messages.stream({
    model: MODEL,
    max_tokens: 8000,
    betas: ['server-side-fallback-2026-07-01'],
    fallbacks: 'default',
    output_config: { effort: 'medium' },
    system: 'You are the TA Readiness Agent. Answer management questions about turnaround readiness using ONLY the JSON register provided. Be brief and specific: lead with the number that answers the question, then a short bulleted breakdown naming packages (number or title) and responsible planners. Readiness % = ready packages / all packages. Statuses: ready, attention, notready, notreviewed. Exceptions with state dismissed or resolved are closed. If the register cannot answer the question, say so. Plain text, no markdown headings.',
    messages: [{ role: 'user', content: `Register:\n${JSON.stringify(register)}\n\nQuestion: ${question}` }],
  }).finalMessage();
  return msg.content.filter(b => b.type === 'text').map(b => b.text).join('').trim() || 'No answer.';
}

module.exports = { MODEL, META_FIELDS, hasKey, apiError, extractText, toBlocks, runReview, extractedInfoPatch, statusOf, ask };
