// TA Readiness AI — document preparation before the AI review.
//  1. PDF text layer, rebuilt into lines/columns, so table values (BOM, blind list, SAP job plan)
//     reach the model as exact characters instead of being read off a page image.
//  2. SAP job plan operation lines parsed into rows with code (operation, work center, hours).
//  3. Large drawing pages (P&ID, ISO, GA / construction, MDR) rendered at high resolution and cut
//     into overlapping zoomed tiles so small line sizes and flange ratings stay legible.
const path = require('path');

let pdfjsPromise = null;
function pdfjs() {
  // pdfjs-dist ships as ESM only.
  if (!pdfjsPromise) pdfjsPromise = import('pdfjs-dist/legacy/build/pdf.mjs');
  return pdfjsPromise;
}
let canvasLib = null;
function canvas() {
  if (!canvasLib) canvasLib = require('@napi-rs/canvas');
  return canvasLib;
}

// pdfjs wants a forward-slash path with a trailing slash, on Windows too.
const FONT_DIR = path.join(path.dirname(require.resolve('pdfjs-dist/package.json')), 'standard_fonts').replace(/\\/g, '/') + '/';

const LIMITS = {
  drawingPages: 6,          // pages rendered as tiles per review
  maxTiles: 36,             // across the whole review
  maxTileBytes: 16 * 1048576,
  targetLongEdge: 4200,     // px for a rendered drawing page
  maxScale: 3,              // ~216 dpi cap
  tileEdge: 1560,           // API images above ~1568 px are downscaled
  overlap: 0.08,
  jpegQuality: 82,
};

const DRAWING_NAME = /p\s*&\s*id|\bpid\b|\biso\b|isometric|\bdwg\b|drawing|\bga\b|general arrangement|construction|fabrication|\bmdr\b|data sheet|nozzle/i;

// ------------------------------------------------------------------ text layer

function textLines(items) {
  // Group glyph runs by baseline (y), then order by x and keep column gaps visible.
  const rows = [];
  items.forEach(it => {
    if (!it.str || !it.str.trim()) return;
    const x = it.transform[4];
    const y = it.transform[5];
    const h = Math.abs(it.transform[3]) || it.height || 8;
    let row = rows.find(r => Math.abs(r.y - y) <= Math.max(2, h * 0.35));
    if (!row) { row = { y, h, parts: [] }; rows.push(row); }
    row.parts.push({ x, w: it.width || it.str.length * h * 0.5, s: it.str, h });
  });
  rows.sort((a, b) => b.y - a.y);
  return rows.map(r => {
    r.parts.sort((a, b) => a.x - b.x);
    let line = '';
    let end = null;
    r.parts.forEach(p => {
      if (end !== null) {
        const gap = p.x - end;
        const cw = p.h * 0.5;
        line += gap > cw * 3 ? '  |  ' : gap > cw * 0.4 ? ' ' : '';
      }
      line += p.s;
      end = p.x + p.w;
    });
    return line.replace(/\s+$/, '');
  }).filter(Boolean);
}

// ------------------------------------------------------------------ SAP job plan operations

// e.g. "0110 0010 2-DO API 510 ON INTERNAL/EXT OF 004-0038 TAHWCH 2002 2.0 HR 1 1.000 2 H"
const OP_LINE = /^\s*(\d{4})(?:\s*\|?\s*(\d{4}))?\s*\|?\s*(.+?)\s*\|?\s*([A-Z][A-Z0-9]{3,9})\s*\|?\s*(\d{4})\s*\|?\s*(\d+(?:[.,]\d+)?)\s*\|?\s*(HR|H|MIN)\b(.*)$/;

function parseOperations(lines) {
  const ops = [];
  lines.forEach(raw => {
    const m = OP_LINE.exec(raw.replace(/\s*\|\s*/g, ' '));
    if (!m) return;
    const rest = (m[8] || '').trim().split(/\s+/);
    ops.push({
      operation: m[1],
      suboperation: m[2] || '',
      description: m[3].trim(),
      work_center: m[4],
      plant: m[5],
      work: m[6].replace(',', '.') + ' ' + m[7],
      people: rest[0] && /^\d+$/.test(rest[0]) ? rest[0] : '',
      duration: rest.length >= 3 ? rest.slice(-2).join(' ') : '',
    });
  });
  return ops;
}

// ------------------------------------------------------------------ rendering

async function toTiles(cv, label, budget) {
  const { createCanvas } = canvas();
  const W = cv.width;
  const H = cv.height;
  const step = Math.floor(LIMITS.tileEdge * (1 - LIMITS.overlap));
  const cols = Math.max(1, Math.ceil((W - LIMITS.tileEdge) / step) + 1);
  const rows = Math.max(1, Math.ceil((H - LIMITS.tileEdge) / step) + 1);
  const tiles = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if (budget.tiles >= LIMITS.maxTiles || budget.bytes >= Math.min(LIMITS.maxTileBytes, budget.maxBytes)) return tiles;
      const x = Math.min(c * step, Math.max(0, W - LIMITS.tileEdge));
      const y = Math.min(r * step, Math.max(0, H - LIMITS.tileEdge));
      const w = Math.min(LIMITS.tileEdge, W);
      const h = Math.min(LIMITS.tileEdge, H);
      const t = createCanvas(w, h);
      t.getContext('2d').drawImage(cv, x, y, w, h, 0, 0, w, h);
      const data = await t.encode('jpeg', LIMITS.jpegQuality);
      budget.tiles++;
      budget.bytes += data.length;
      tiles.push({
        label: `${label} — zoomed tile row ${r + 1}/${rows}, column ${c + 1}/${cols} (top-left ${Math.round((x / W) * 100)}% across, ${Math.round((y / H) * 100)}% down)`,
        data,
      });
    }
  }
  return tiles;
}

async function renderPdfPage(page, label, budget) {
  const { createCanvas } = canvas();
  const base = page.getViewport({ scale: 1 });
  const scale = Math.min(LIMITS.maxScale, LIMITS.targetLongEdge / Math.max(base.width, base.height));
  const vp = page.getViewport({ scale });
  const cv = createCanvas(Math.ceil(vp.width), Math.ceil(vp.height));
  const ctx = cv.getContext('2d');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, cv.width, cv.height);
  await page.render({ canvasContext: ctx, viewport: vp }).promise;
  return toTiles(cv, label, budget);
}

function isDrawingPage(name, vp, pageCount) {
  const long = Math.max(vp.width, vp.height);
  if (long >= 1000) return true; // larger than letter / A4 — 11x17 and up
  const landscape = vp.width > vp.height;
  return landscape && DRAWING_NAME.test(name) && pageCount <= 20;
}

// ------------------------------------------------------------------ public

/**
 * Prepare one PDF: text layer, parsed operations and zoomed drawing tiles.
 * budget is shared across the whole review so the request stays within limits.
 */
async function preparePdf(name, buffer, budget) {
  const out = { text: '', operations: [], tiles: [], drawingPages: [], pages: 0, error: '' };
  let task = null;
  try {
    const lib = await pdfjs();
    task = lib.getDocument({
      data: new Uint8Array(buffer),
      standardFontDataUrl: FONT_DIR,
      useSystemFonts: false,
      disableFontFace: true,
      isEvalSupported: false,
      verbosity: 0,
    });
    const doc = await task.promise;
    out.pages = doc.numPages;
    const allLines = [];
    for (let i = 1; i <= doc.numPages; i++) {
      const page = await doc.getPage(i);
      const lines = textLines((await page.getTextContent()).items);
      if (lines.length) allLines.push(`--- page ${i} ---`, ...lines);
      const vp = page.getViewport({ scale: 1 });
      if (isDrawingPage(name, vp, doc.numPages) && budget.pages < LIMITS.drawingPages && budget.tiles < LIMITS.maxTiles) {
        budget.pages++;
        out.drawingPages.push(i);
        out.tiles.push(...await renderPdfPage(page, `${name}, page ${i}`, budget));
      }
      page.cleanup();
    }
    out.text = allLines.join('\n');
    out.operations = parseOperations(allLines);
  } catch (e) {
    out.error = e.message;
  } finally {
    if (task) await task.destroy().catch(() => {});
  }
  return out;
}

/** Large photos / scans of drawings uploaded as images get the same tiling. */
async function prepareImage(name, buffer, budget) {
  try {
    const { loadImage, createCanvas } = canvas();
    const img = await loadImage(buffer);
    if (Math.max(img.width, img.height) <= LIMITS.tileEdge * 1.3 || budget.tiles >= LIMITS.maxTiles) return [];
    const cv = createCanvas(img.width, img.height);
    cv.getContext('2d').drawImage(img, 0, 0);
    return await toTiles(cv, name, budget);
  } catch {
    return [];
  }
}

/** Plain-text lines (CSV / Word / text) can also hold a job plan export. */
function operationsFromText(text) {
  return parseOperations(String(text || '').split(/\r?\n/).map(l => l.replace(/,/g, ' ')));
}

// maxBytes: room left in the request for tiles once the original files are counted.
const newBudget = (maxBytes = LIMITS.maxTileBytes) => ({ pages: 0, tiles: 0, bytes: 0, maxBytes });

module.exports = { preparePdf, prepareImage, operationsFromText, parseOperations, textLines, newBudget, LIMITS };
