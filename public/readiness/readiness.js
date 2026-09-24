// TA Readiness AI — package upload, AI cross-check review, verification and approval.
(function () {
  'use strict';

  const API = '/readiness/api';
  const ACCEPT = ['.pdf', '.png', '.jpg', '.jpeg', '.gif', '.webp', '.xlsx', '.xls', '.xlsm', '.csv', '.docx', '.txt', '.md', '.json', '.xml'];
  const MAX_REVIEW_BYTES = 30 * 1048576;
  const WORKFLOW = ['Upload', 'AI Review', 'Exceptions', 'Human Verification', 'Readiness', 'Approval'];
  const CHECK_LABELS = {
    scope_match: 'Inspection plan / IWRs ↔ job plan operations',
    pid_connections: 'P&ID connections ↔ MDR ↔ BOM ↔ blind list',
    jobplan: 'Work package / job plan',
    drawing: 'IFC drawing / isometric revision',
    bom: 'BOM & material specification',
    wps: 'WPS / PQR coverage',
    welders: 'Welder qualifications',
    nde: 'NDE plan (RT / UT / TOFD / WFMT / VT / EC)',
    ptest: 'Pressure-test requirement',
    flange: 'Flange verification: BOM ↔ P&ID / MDR / construction / ISO',
    refractory: 'Refractory specification & dryout',
    coating: 'Coating specification & ITP',
    itp: 'Inspection plan hold points & QA/QC forms',
    assign: 'Planner / inspector assignment',
    approvals: 'Approvals & signatures',
  };
  const STATUS_LABEL = { ready: 'Ready', attention: 'Needs Attention', notready: 'Not Ready', notreviewed: 'Not Reviewed' };
  const TRACE_LABEL = { matched: 'Matched', partial: 'Partial', missing: 'Missing', referenced_elsewhere: 'Other W.O.', not_a_task: 'Info only' };
  const META = ['title', 'number', 'unit', 'system', 'equipment', 'planner', 'inspector'];
  const META_LABEL = { title: 'Title / scope', number: 'Package / W.O. number', unit: 'Unit', system: 'System', equipment: 'Equipment / line', planner: 'Planner', inspector: 'Inspector' };

  const S = {
    health: null, offline: false, loaded: false, packages: [],
    selectedId: null, statusFilter: '', search: '',
    showNew: false, newFiles: [], creating: false, createStep: '',
    editing: false, uploading: false, error: '', now: Date.now(),
    agentOpen: false, asks: [], asking: false,
  };

  // ------------------------------------------------------------------ auth + http

  function token() {
    try { if (window.parent && window.parent !== window && window.parent.authToken) return window.parent.authToken; } catch (e) { /* cross-origin */ }
    try { const t = localStorage.getItem('authToken'); if (t) return t; } catch (e) { /* storage blocked */ }
    try { return sessionStorage.getItem('authToken') || ''; } catch (e) { return ''; }
  }

  async function call(method, url, body) {
    const opts = { method, headers: { Authorization: 'Bearer ' + token() } };
    if (body instanceof FormData) opts.body = body;
    else if (body !== undefined) { opts.headers['Content-Type'] = 'application/json'; opts.body = JSON.stringify(body); }
    let res;
    try { res = await fetch(API + url, opts); } catch (e) { throw new Error('The server could not be reached.'); }
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const err = new Error(data.error || ('Request failed (' + res.status + ')'));
      err.status = res.status;
      throw err;
    }
    return data;
  }

  // ------------------------------------------------------------------ helpers

  const $ = (id) => document.getElementById(id);
  const esc = (v) => String(v == null ? '' : v).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const joined = (parts, sep) => parts.filter(Boolean).join(sep);
  const size = (n) => (n > 1048576 ? (n / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(n / 1024)) + ' KB');
  const active = (p) => (p.exceptions || []).filter(e => e.state === 'open' || e.state === 'confirmed');
  const topIssue = (p) => { const a = active(p); return a.find(e => e.severity === 'critical') || a[0] || null; };
  const selected = () => S.packages.find(p => p.id === S.selectedId) || null;
  const extOk = (name) => ACCEPT.indexOf(('.' + name.split('.').pop()).toLowerCase()) >= 0;

  function elapsed(p) {
    if (!p.reviewStartedAt) return '';
    const s = Math.max(0, Math.round((S.now - new Date(p.reviewStartedAt).getTime()) / 1000));
    return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');
  }

  let toastTimer = null;
  function toast(msg) {
    const t = $('toast');
    t.textContent = msg;
    t.classList.remove('hidden');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.add('hidden'), 3500);
  }

  function fail(e, fallback) {
    S.error = e.status === 403 ? 'You do not have access to TA Readiness AI. Ask an admin to add it to your apps.'
      : e.status === 401 ? 'Your session has expired. Log in again from the main page.'
        : (e.message || fallback);
    render();
  }

  function replace(p) {
    const i = S.packages.findIndex(x => x.id === p.id);
    if (i >= 0) S.packages[i] = p; else S.packages.unshift(p);
  }

  // ------------------------------------------------------------------ data

  async function refresh() {
    try {
      const [health, list] = await Promise.all([call('GET', '/health'), call('GET', '/packages')]);
      const before = new Map(S.packages.map(p => [p.id, p.reviewStatus]));
      S.health = health;
      S.offline = false;
      S.packages = list;
      list.forEach(p => {
        if (before.get(p.id) === 'reviewing' && p.reviewStatus === 'done') toast((p.number || p.title) + ': AI review finished — ' + p.exceptions.length + ' finding(s).');
        if (before.get(p.id) === 'reviewing' && p.reviewStatus === 'error') toast((p.number || p.title) + ': review failed.');
      });
    } catch (e) {
      if (e.status === 401 || e.status === 403) fail(e);
      else S.offline = true;
    }
    S.loaded = true;
    render();
  }

  // ------------------------------------------------------------------ render: page

  function tally() {
    const t = { total: S.packages.length, ready: 0, attention: 0, notready: 0, notreviewed: 0, pct: 0 };
    S.packages.forEach(p => t[p.status]++);
    t.pct = t.total ? Math.round((t.ready / t.total) * 100) : 0;
    return t;
  }

  function renderHeader() {
    const c = $('conn');
    const h = S.health;
    c.className = 'conn ' + (S.offline ? 'bad' : h && !h.hasKey ? 'warn' : h ? 'ok' : '');
    c.querySelector('span').textContent = S.offline ? 'Server unreachable' : !h ? 'Connecting…' : h.hasKey ? 'AI ready · ' + h.model : 'AI key not configured';

    let b = '';
    if (S.offline) b += '<div class="banner bad">&#9888; <div><b>The server could not be reached.</b> This page retries automatically.</div></div>';
    if (h && !h.hasKey) b += '<div class="banner warn">&#128273; <div><b>The AI key is not configured on the server.</b> Set <code>ANTHROPIC_API_KEY</code> (and <code>ANTHROPIC_WORKSPACE_ID</code> for an organisation-level key) in the server environment. Packages and documents still work.</div></div>';
    if (S.error) b += '<div class="banner bad">&#9888; <div>' + esc(S.error) + '</div><button class="x" data-action="dismiss-error" aria-label="Dismiss">&#10005;</button></div>';
    $('banners').innerHTML = b;
  }

  function renderKpis() {
    const t = tally();
    const ex = S.packages.reduce((a, p) => a.concat(p.exceptions || []), []);
    const docs = S.packages.reduce((a, p) => a + p.documents.length, 0);
    const counts = [
      docs + ' docs',
      S.packages.filter(p => p.review).length + ' / ' + t.total + ' pkgs',
      ex.filter(e => e.state === 'open' || e.state === 'confirmed').length + ' open',
      ex.filter(e => e.state !== 'open').length + ' / ' + ex.length + ' verified',
      t.ready + ' ready',
      S.packages.filter(p => p.approved).length + ' approved',
    ];
    $('flow').innerHTML = WORKFLOW.map((w, i) => '<li><span class="n">' + (i + 1) + '</span><span class="t">' + w + '</span><span class="c">' + counts[i] + '</span></li>').join('');

    const tile = (key, cls, label, n) => '<button class="card tile ' + cls + (S.statusFilter === key ? ' on' : '') + '" data-action="filter" data-status="' + key + '"><span class="lbl">' + label + '</span><b>' + n + '</b></button>';
    $('kpis').innerHTML =
      '<div class="card ring-card"><div class="ring" style="background:conic-gradient(var(--ok) 0 ' + t.pct + '%, var(--track) ' + t.pct + '% 100%)"><div class="ring-in"><b>' + (t.total ? t.pct + '%' : '–') + '</b><span>TA Readiness</span></div></div>' +
      '<div><div class="big">' + t.total + '</div><div class="muted">work packages</div></div></div>' +
      tile('ready', 'ok', '&#10004; Ready', t.ready) +
      tile('attention', 'warn', '&#9888; Needs Attention', t.attention) +
      tile('notready', 'bad', '&#10006; Not Ready', t.notready) +
      tile('notreviewed', 'idle', '&#8987; Not Reviewed', t.notreviewed);
  }

  function filtered() {
    const q = S.search.trim().toLowerCase();
    return S.packages.filter(p => {
      if (S.statusFilter && p.status !== S.statusFilter) return false;
      if (!q) return true;
      return (p.number + ' ' + p.title + ' ' + p.unit + ' ' + p.system + ' ' + p.equipment + ' ' + p.planner).toLowerCase().indexOf(q) >= 0;
    });
  }

  function statusPill(p, lg) {
    const L = lg ? ' lg' : '';
    if (p.reviewStatus === 'reviewing') return '<span class="pill reviewing' + L + '"><span class="spin"></span> ' + (lg ? 'AI reviewing · ' : 'Reviewing ') + elapsed(p) + '</span>';
    if (p.reviewStatus === 'error' && !lg) return '<span class="pill notready">Review failed</span>';
    return '<span class="pill ' + p.status + L + '">' + STATUS_LABEL[p.status] + '</span>';
  }

  const displayTitle = (p) => (p.reviewStatus === 'reviewing' && p.title === 'New package' ? 'Reading package details…' : p.title);

  function renderList() {
    const el = $('list');
    if (!S.loaded) { el.innerHTML = ''; return; }
    if (!S.packages.length) {
      el.innerHTML = S.offline ? '' :
        '<div class="card empty-state"><div class="big-ico">&#128194;</div><h2>No packages yet</h2>' +
        '<p>Drop the documents for a work package and let the AI cross-check them.</p><ol>' +
        '<li><b>Drop</b> all documents for one work package: job plan, IFC drawings / ISOs, BOM, WPS/PQR, inspection plan, NDE request, flange log, ITP… (PDF, images, Excel, Word, text)</li>' +
        '<li>The <b>AI reads the package details</b> (number, unit, equipment, planner) and <b>cross-checks</b> the documents against each other</li>' +
        '<li><b>Verify</b> each finding, then <b>approve</b> when the package is Ready</li></ol>' +
        '<button class="btn btn-primary" data-action="new">+ Create first package</button></div>';
      return;
    }
    const rows = filtered();
    let chips = '';
    if (S.statusFilter || S.search) {
      chips = '<div class="chips">' +
        (S.statusFilter ? '<span class="chip">Status: ' + STATUS_LABEL[S.statusFilter] + '<button data-action="clear-status">&#215;</button></span>' : '') +
        (S.search ? '<span class="chip">“' + esc(S.search) + '”<button data-action="clear-search">&#215;</button></span>' : '') +
        '<span class="count">' + rows.length + ' packages</span></div>';
    }
    const body = rows.map(p => {
      const t = topIssue(p);
      const a = active(p);
      let issue;
      if (t) issue = '<span class="sev ' + t.severity + '"></span>' + esc(t.title) + (a.length > 1 ? '<small>+' + (a.length - 1) + ' more</small>' : '');
      else if (p.review) issue = '<span class="muted">All required documentation verified</span>';
      else if (p.reviewStatus !== 'reviewing') issue = '<span class="muted">' + (p.documents.length ? 'Ready for AI review' : 'Upload documents') + '</span>';
      else issue = '';
      return '<tr class="click" data-action="open" data-id="' + p.id + '">' +
        '<td>' + (p.number ? '<span class="mono">' + esc(p.number) + ' · </span>' : '') + esc(displayTitle(p)) + (p.approved ? '<span class="appr" title="Approved">&#10004;</span>' : '') + '</td>' +
        '<td>' + esc(p.unit || '—') + '<small>' + esc(joined([p.system, p.equipment], ' · ')) + '</small></td>' +
        '<td>' + esc(p.planner || '—') + '</td>' +
        '<td class="r">' + p.documents.length + '</td>' +
        '<td>' + statusPill(p) + '</td>' +
        '<td>' + issue + '</td></tr>';
    }).join('') || '<tr><td colspan="6" class="empty">No packages match.</td></tr>';
    el.innerHTML = '<div class="card explorer"><div class="ex-head"><h2>Work packages</h2>' +
      '<div class="search">&#128269;<input id="search" placeholder="Search package, unit, equipment, planner…" value="' + esc(S.search) + '"></div></div>' + chips +
      '<table><thead><tr><th>Package</th><th>Location</th><th>Planner</th><th class="r">Docs</th><th>Status</th><th>Top finding</th></tr></thead><tbody>' + body + '</tbody></table></div>';
  }

  // ------------------------------------------------------------------ render: overlays

  function renderNewModal() {
    const total = S.newFiles.reduce((a, f) => a + f.size, 0);
    const hasKey = S.health && S.health.hasKey;
    return '<div class="scrim" data-action="close-new"></div><div class="modal card">' +
      '<h3>New work package</h3>' +
      '<p class="sub">Drop every document for <b>one</b> work package. The AI reads the package number, unit, equipment, planner and inspector from them; you can edit those afterwards.</p>' +
      '<div class="drop big" id="newDrop" data-action="pick-new"><span class="ico">&#11014;</span><div><b>Drop package files here or click to browse</b>' +
      '<small>Job plan, IFC drawings / ISOs, BOM, WPS/PQR, inspection plan, NDE request, flange log, ITP…</small><small>PDF, images, Excel/CSV, Word, text</small></div></div>' +
      '<button class="link" data-action="pick-folder">&#128193; Or choose a whole folder</button>' +
      (S.newFiles.length ? '<ul class="doclist">' + S.newFiles.map((f, i) =>
        '<li>&#128196;<span class="fname">' + esc(f.name) + '</span><span class="muted">' + size(f.size) + '</span>' +
        '<button class="icon" data-action="remove-new" data-i="' + i + '"' + (S.creating ? ' disabled' : '') + ' aria-label="Remove">&#10005;</button></li>').join('') + '</ul>' +
        '<p class="hint">' + S.newFiles.length + ' file(s) · ' + size(total) + (total > MAX_REVIEW_BYTES ? ' <span class="c-bad">· over the ~30 MB per-review limit</span>' : '') + '</p>' : '') +
      (!hasKey ? '<p class="hint c-warn">The AI key is not configured yet: the package will be created, but the review waits until the key is set.</p>' : '') +
      '<div class="modal-actions">' + (S.createStep ? '<span class="step"><span class="spin"></span> ' + esc(S.createStep) + '</span>' : '') +
      '<button class="btn btn-outline" data-action="close-new"' + (S.creating ? ' disabled' : '') + '>Cancel</button>' +
      '<button class="btn btn-primary" data-action="create"' + (!S.newFiles.length || S.creating ? ' disabled' : '') + '>&#10022; ' + (hasKey ? 'Create &amp; run AI review' : 'Create package') + '</button></div></div>';
  }

  function checkRows(p) {
    const checks = (p.review && p.review.checks) || [];
    return Object.keys(CHECK_LABELS).map(key => ({
      key, label: CHECK_LABELS[key],
      check: checks.find(c => c.check === key) || null,
      ex: p.exceptions.filter(e => e.check === key),
    })).filter(r => (r.check && r.check.status !== 'not_applicable') || r.ex.length);
  }

  function rowState(r) {
    const a = r.ex.filter(e => e.state === 'open' || e.state === 'confirmed');
    if (a.some(e => e.severity === 'critical')) return 'critical';
    if (a.length) return 'warning';
    if (r.check && r.check.status === 'insufficient_info') return 'info';
    if (r.ex.length) return 'ok';
    return r.check && (r.check.status === 'critical' || r.check.status === 'warning') ? r.check.status : 'ok';
  }
  const ROW_ICON = { ok: '&#10004;', warning: '&#9888;', critical: '&#10006;', info: '?' };

  function renderException(p, e) {
    const closed = e.state === 'dismissed' || e.state === 'resolved';
    const stateText = e.state === 'open' ? 'Awaiting human verification'
      : e.state === 'confirmed' ? 'Confirmed by ' + e.verifiedBy
        : e.state === 'dismissed' ? 'False positive (' + e.verifiedBy + ')' : 'Resolved (' + e.verifiedBy + ')';
    const act = (s, label, cls) => '<button' + (cls ? ' class="' + cls + '"' : '') + ' data-action="ex-state" data-ex="' + esc(e.id) + '" data-state="' + s + '">' + label + '</button>';
    return '<div class="ex' + (closed ? ' closed' : '') + '">' +
      '<div class="ex-title"><span class="sev ' + e.severity + '"></span><span class="sevlbl">' + e.severity + '</span>' + esc(e.title) + '</div>' +
      (e.detail ? '<div class="ex-detail">' + esc(e.detail) + '</div>' : '') +
      (e.evidence || []).map(ev => '<div class="ex-src">&#128196; <b>' + esc(ev.file_name) + '</b>' + (ev.location ? ' · ' + esc(ev.location) : '') + (ev.quote ? '<q>' + esc(ev.quote) + '</q>' : '') + '</div>').join('') +
      '<div class="ex-basis"><span class="btag' + (e.basis_type === 'code' ? ' code' : '') + '">' + (e.basis_type === 'code' ? 'Code / standard' : 'Package cross-check') + '</span>' + esc(e.basis) + '</div>' +
      (e.recommended_action ? '<div class="ex-basis">&#128295; ' + esc(e.recommended_action) + '</div>' : '') +
      '<div class="ex-foot"><span class="state ' + e.state + '">' + esc(stateText) + '</span><span class="muted">' + esc(e.discipline) + ' · Owner: ' + esc(e.owner) + '</span><span class="acts">' +
      (e.state === 'open' ? act('confirmed', 'Confirm') + act('dismissed', 'False positive') : '') +
      (e.state === 'open' || e.state === 'confirmed' ? act('resolved', 'Mark resolved', 'res') : '') +
      (closed ? act('open', 'Reopen') : '') + '</span></div></div>';
  }

  const CONN_LABEL = { match: 'Match', size_mismatch: 'Size mismatch', not_on_blind_list: 'Not on blind list', not_in_bom: 'Not in BOM', not_in_mdr: 'Not in MDR', no_isolation_needed: 'No blind needed' };
  const CONN_CLASS = { match: 'matched', size_mismatch: 'missing', not_on_blind_list: 'missing', not_in_bom: 'partial', not_in_mdr: 'partial', no_isolation_needed: 'not_a_task' };

  function renderConnections(cr) {
    if (!cr || !(cr.connections || []).length) return '';
    const bad = cr.connections.filter(c => c.status !== 'match' && c.status !== 'no_isolation_needed').length;
    const cell = (v) => '<td class="mono' + (v === 'none' ? ' c-bad' : '') + '">' + esc(v || '—') + '</td>';
    return '<h4>P&amp;ID connections' + (cr.equipment ? ' · ' + esc(cr.equipment) : '') +
      '<span class="trace-sum">' + (cr.connections.length - bad) + ' of ' + cr.connections.length + ' OK' + (bad ? ' <span class="c-bad">· ' + bad + ' issue(s)</span>' : '') + '</span></h4>' +
      (cr.documents_used ? '<p class="hint">Compared: ' + esc(cr.documents_used) + '</p>' : '') +
      '<div class="table-scroll"><table class="wo-tbl conn-tbl"><thead><tr><th>Connection</th><th>P&amp;ID</th><th>MDR</th><th>Construction</th><th>ISO</th><th>BOM</th><th>Blind list</th><th>Status</th></tr></thead><tbody>' +
      cr.connections.map(c => '<tr class="' + (CONN_CLASS[c.status] === 'missing' ? 'critical' : CONN_CLASS[c.status] === 'partial' ? 'warning' : '') + '">' +
        '<td><b class="mono">' + esc(c.connection) + '</b>' + (c.description ? '<small>' + esc(c.description) + '</small>' : '') + (c.comment ? '<small class="tcomment">' + esc(c.comment) + '</small>' : '') + '</td>' +
        cell(c.pid_size) + cell(c.mdr_size) + cell(c.construction_size) + cell(c.iso_size) + cell(c.bom_size) + cell(c.blind_list_size) +
        '<td><span class="tpill ' + CONN_CLASS[c.status] + '">' + CONN_LABEL[c.status] + '</span></td></tr>').join('') +
      '</tbody></table></div>';
  }

  const FLANGE_LABEL = { match: 'Match', size_mismatch: 'Size mismatch', rating_mismatch: 'Rating mismatch', qty_mismatch: 'Qty mismatch', not_on_drawings: 'Not on drawings' };
  const FLANGE_CLASS = { match: 'matched', size_mismatch: 'missing', rating_mismatch: 'missing', qty_mismatch: 'partial', not_on_drawings: 'partial' };

  function renderFlanges(fr) {
    if (!fr || !(fr.items || []).length) return '';
    const bad = fr.items.filter(f => f.status !== 'match').length;
    const cell = (v) => '<td class="mono' + (v === 'none' ? ' c-bad' : '') + '">' + esc(v || '—') + '</td>';
    return '<h4>Flange verification · BOM → P&amp;ID / MDR / construction / ISO' +
      '<span class="trace-sum">' + (fr.items.length - bad) + ' of ' + fr.items.length + ' BOM items OK' + (bad ? ' <span class="c-bad">· ' + bad + ' issue(s)</span>' : '') + '</span></h4>' +
      (fr.documents_used ? '<p class="hint">Compared: ' + esc(fr.documents_used) + '</p>' : '') +
      '<div class="table-scroll"><table class="wo-tbl conn-tbl"><thead><tr><th>BOM item</th><th>BOM size / qty</th><th>P&amp;ID</th><th>MDR</th><th>Construction</th><th>ISO</th><th>Required</th><th>Status</th></tr></thead><tbody>' +
      fr.items.map(f => '<tr class="' + (FLANGE_CLASS[f.status] === 'missing' ? 'critical' : FLANGE_CLASS[f.status] === 'partial' ? 'warning' : '') + '">' +
        '<td><b class="mono">' + esc(f.bom_item) + '</b>' + (f.description ? '<small>' + esc(f.description) + '</small>' : '') + (f.comment ? '<small class="tcomment">' + esc(f.comment) + '</small>' : '') + '</td>' +
        '<td class="mono">' + esc(f.bom_size || '—') + (f.bom_qty ? ' ×' + esc(f.bom_qty) : '') + '</td>' +
        cell(f.pid) + cell(f.mdr) + cell(f.construction) + cell(f.iso) +
        '<td class="mono">' + esc(f.required_qty || '—') + '</td>' +
        '<td><span class="tpill ' + FLANGE_CLASS[f.status] + '">' + FLANGE_LABEL[f.status] + '</span></td></tr>').join('') +
      '</tbody></table></div>';
  }

  function renderTraceability(t) {
    if (!t) return '';
    const tasks = (t.plan_items || []).filter(i => i.status !== 'not_a_task');
    const matched = tasks.filter(i => i.status === 'matched').length;
    const gaps = tasks.length - matched;
    let h = '<h4>Inspection plan ↔ job plan' + (tasks.length ? '<span class="trace-sum">' + matched + ' of ' + tasks.length + ' tasks matched' + (gaps ? ' <span class="c-bad">· ' + gaps + ' gap(s)</span>' : '') + '</span>' : '') + '</h4>';
    if (t.equipment_consistency) h += '<div class="banner slim' + (t.equipment_mismatch ? ' bad' : '') + '">&#127991; <div><b>Equipment / W.O.:</b> ' + esc(t.equipment_consistency) + '</div></div>';
    if (t.duration_consistency) h += '<div class="banner slim">&#9201; <div><b>Durations:</b> ' + esc(t.duration_consistency) + '</div></div>';
    if ((t.plan_items || []).length) {
      h += '<div class="trace">' + t.plan_items.map(i =>
        '<div class="trace-row ' + i.status + '"><div><span class="tpill ' + i.status + '">' + (TRACE_LABEL[i.status] || i.status) + '</span>' +
        '<span class="ttype">' + (i.item_type === 'recommendation' ? 'IWR' : i.item_type === 'inspection_plan' ? 'Insp. plan' : 'Scope') + '</span>' + esc(i.item) + '</div>' +
        '<div>' + (i.operations ? '<div class="ops">' + esc(i.operations) + '</div>' : '<span class="muted">No job plan operation</span>') +
        (i.comment ? '<span class="tcomment">' + esc(i.comment) + '</span>' : '') + '</div></div>').join('') + '</div>';
    }
    if ((t.wo_references || []).length) {
      h += '<h4>Work orders referenced in the package (' + t.wo_references.length + ')</h4><table class="wo-tbl"><thead><tr><th>W.O.</th><th>Where</th><th>Context</th><th>Status</th></tr></thead><tbody>' +
        t.wo_references.map(w => '<tr class="' + (w.status === 'not_in_package' ? w.severity : '') + '"><td class="mono">' + esc(w.wo_number) + '</td><td>' + esc(w.source_location) + '</td><td>' + esc(w.context) +
          (w.comment ? '<small>' + esc(w.comment) + '</small>' : '') + '</td><td><span class="tpill ' + w.status + '">' +
          ({ this_package: 'This package', included: 'Included', not_in_package: 'Not in package' }[w.status] || esc(w.status)) + '</span></td></tr>').join('') + '</tbody></table>';
    }
    if ((t.unmatched_operations || []).length) {
      h += '<details class="fold" open><summary>Job plan operations not in the inspection plan / IWRs (' + t.unmatched_operations.length + ')</summary><ul>' +
        t.unmatched_operations.map(o => '<li><b class="mono">' + esc(o.operation) + '</b> ' + esc(o.description) + ' <small>— ' + esc(joined([o.work_center, o.comment], ' · ')) + '</small></li>').join('') + '</ul></details>';
    }
    return h;
  }

  function renderDrawer(p) {
    const hasKey = S.health && S.health.hasKey;
    const reviewing = p.reviewStatus === 'reviewing';
    let head;
    if (S.editing) {
      head = '<form class="edit-grid" id="editForm">' + META.map(k =>
        '<label class="field' + (k === 'title' ? ' full' : '') + '"><span>' + META_LABEL[k] + '</span><input name="' + k + '" value="' + esc(p[k]) + '"></label>').join('') +
        '<div class="edit-actions full"><button type="button" class="btn btn-outline btn-sm" data-action="edit-cancel">Cancel</button><button type="submit" class="btn btn-primary btn-sm">Save</button></div></form>';
    } else {
      head = '<div class="eyebrow mono">' + esc(p.number || 'Work package') + (p.metaFromAi ? '<span class="ai-tag">&#10022; details read by AI</span>' : '') + '</div>' +
        '<h3>' + esc(displayTitle(p)) + '</h3>' +
        '<div class="meta">' + esc(joined([p.unit, p.system, p.equipment], ' › ')) + '</div>' +
        (p.planner || p.inspector ? '<div class="meta">Planner <b>' + esc(p.planner || '—') + '</b> · Inspector <b>' + esc(p.inspector || '—') + '</b></div>' : '') +
        '<button class="link" data-action="edit">&#9998; Edit details</button>';
    }

    let status = statusPill(p, true);
    if (p.approved) status += '<span class="approved">&#10004; Approved by ' + esc(p.approvedBy) + '</span>';
    status += '<span class="spacer"></span>';
    if (p.status === 'ready' && !p.approved && !reviewing) status += '<button class="btn btn-primary" data-action="approve">&#9998; Approve package</button>';
    if (!reviewing) {
      const why = !hasKey ? 'AI key not configured on the server' : !p.documents.length ? 'Upload documents first' : '';
      status += '<button class="btn btn-primary" data-action="review"' + (why ? ' disabled title="' + why + '"' : '') + '>&#10022; ' + (p.review ? 'Re-run AI review' : 'Run AI review') + '</button>';
    }

    let body = '<h4>Documents (' + p.documents.length + ')</h4>' +
      '<div class="drop" id="addDrop" data-action="pick-add"><span class="ico">&#11014;</span><div><b>' + (S.uploading ? 'Uploading…' : 'Drop files here or click to browse') + '</b><small>PDF, images, Excel/CSV, Word, text · up to 30 MB each, ~30 MB per review</small></div></div>';
    if (p.documents.length) {
      body += '<ul class="doclist" style="margin-top:10px">' + p.documents.map(d =>
        '<li>&#128196;<button class="fname link-like" data-action="open-doc" data-doc="' + d.id + '" title="Open">' + esc(d.name) + '</button><span class="muted">' + size(d.size) + '</span>' +
        '<button class="icon" data-action="remove-doc" data-doc="' + d.id + '"' + (reviewing ? ' disabled' : '') + ' aria-label="Remove">&#128465;</button></li>').join('') + '</ul>';
    }
    if (p.reviewStale && !reviewing) body += '<div class="banner slim warn">&#8635; <div>Documents changed since the last review. Re-run the AI review to refresh the findings.</div></div>';
    if (p.reviewStatus === 'error') body += '<div class="banner slim bad">&#9888; <div><b>Review failed:</b> ' + esc(p.reviewError) + '</div></div>';
    if (reviewing) body += '<div class="reviewing-box"><span class="spin lg"></span><div><b>The AI is reading ' + p.documents.length + ' document(s) and cross-checking them.</b><small>Large packages can take a few minutes. You can close this panel; the list updates when it finishes.</small></div></div>';

    if (p.review && !reviewing) {
      const r = p.review;
      body += '<h4>AI summary</h4><p class="summary">' + esc(r.package_summary) + '</p>';
      if ((r.scope_requirements || []).length) {
        body += '<details class="fold"><summary>Scope requirements extracted (' + r.scope_requirements.length + ')</summary><ul>' +
          r.scope_requirements.map(q => '<li>' + esc(q.requirement) + ' <small>— ' + esc(joined([q.source_file, q.source_location], ', ')) + '</small></li>').join('') + '</ul></details>';
      }
      body += renderTraceability(r.task_traceability);
      body += renderFlanges(r.flange_register);
      body += renderConnections(r.connection_register);
      body += '<h4>Cross-check</h4><div class="checks">' + checkRows(p).map(row => {
        const st = rowState(row);
        return '<div class="check ' + st + '"><div class="check-top"><span class="ci">' + ROW_ICON[st] + '</span>' + esc(row.label) + '</div>' +
          (row.check && row.check.finding ? '<div class="finding">' + esc(row.check.finding) + '</div>' : '') +
          row.ex.map(e => renderException(p, e)).join('') + '</div>';
      }).join('') + '</div>';
      const na = (r.checks || []).filter(c => c.status === 'not_applicable' && !p.exceptions.some(e => e.check === c.check)).map(c => CHECK_LABELS[c.check] || c.check);
      if (na.length) body += '<p class="hint">Not applicable to this scope: ' + esc(na.join(', ')) + '.</p>';
      if ((r.documents || []).length) {
        body += '<details class="fold"><summary>Documents identified by the AI (' + r.documents.length + ')</summary><table class="wo-tbl"><thead><tr><th>File</th><th>Type</th><th>Identifier</th><th>Rev</th></tr></thead><tbody>' +
          r.documents.map(d => '<tr><td>' + esc(d.file_name) + '</td><td>' + esc(String(d.document_type || '').replace(/_/g, ' ')) + '</td><td>' + esc(d.identifier) + '</td><td>' + esc(d.revision) + '</td></tr>').join('') + '</tbody></table></details>';
      }
      if ((r.skipped || []).length) body += '<p class="hint">Not read: ' + esc(r.skipped.join(', ')) + '</p>';
      if (r.preparation) {
        const pr = r.preparation;
        body += '<p class="hint">Prepared for the AI: ' + pr.tiles + ' zoomed drawing tile(s) · ' + pr.operations + ' job plan operation(s) parsed' +
          ((pr.notes || []).length ? ' · ' + esc(pr.notes.join('; ')) : '') + '</p>';
      }
      body += '<p class="hint">Reviewed ' + esc(new Date(r.ranAt).toLocaleString()) + ' by ' + esc(r.model) + ' · ' + (r.usage.input_tokens || 0).toLocaleString() + ' in / ' + (r.usage.output_tokens || 0).toLocaleString() + ' out tokens. AI findings must be verified by a qualified person.</p>';
    }
    body += '<div class="danger-zone"><button class="btn btn-outline btn-danger-text" data-action="delete">&#128465; Delete package</button></div>';

    return '<div class="scrim" data-action="close-drawer"></div><aside class="drawer">' +
      '<div class="dr-head"><div>' + head + '</div><button class="x" data-action="close-drawer" aria-label="Close">&#10005;</button></div>' +
      '<div class="dr-status">' + status + '</div><div class="dr-body" id="drBody">' + body + '</div></aside>';
  }

  function renderOverlay() {
    const prev = $('drBody');
    const scroll = prev ? prev.scrollTop : 0;
    const p = selected();
    let html = '';
    if (p) html += renderDrawer(p);
    if (S.showNew) html += renderNewModal();
    $('overlay').innerHTML = html;
    const now = $('drBody');
    if (now && prev) now.scrollTop = scroll;
  }

  function renderAgent() {
    $('agent').classList.toggle('open', S.agentOpen);
    let h = '';
    if (!S.asks.length) {
      h = '<div class="msg agent">I answer from the live exception register, so my answers cover only the packages reviewed here.' +
        '<div class="acts"><button data-action="ask" data-q="What is overall readiness and what is blocking it?">What is blocking readiness?</button>' +
        '<button data-action="ask" data-q="Which packages have job plan tasks or work orders not captured?">Uncaptured tasks / W.O.s</button>' +
        '<button data-action="ask" data-q="List outstanding items per planner.">Items per planner</button></div></div>';
    }
    S.asks.forEach(a => {
      h += '<div class="msg user">' + esc(a.q) + '</div>';
      if (a.a) h += '<div class="msg agent' + (a.error ? ' err' : '') + '">' + esc(a.a) + '</div>';
    });
    if (S.asking) h += '<div class="msg agent"><span class="spin"></span></div>';
    $('chat').innerHTML = h;
    $('chat').scrollTop = $('chat').scrollHeight;
  }

  function render() {
    renderHeader();
    renderKpis();
    const focused = document.activeElement && document.activeElement.id === 'search';
    const caret = focused ? document.activeElement.selectionStart : 0;
    renderList();
    if (focused && $('search')) { $('search').focus(); $('search').setSelectionRange(caret, caret); }
    if (!S.editing || !$('editForm')) renderOverlay();
    renderAgent();
  }

  // ------------------------------------------------------------------ actions

  async function createPackage() {
    if (!S.newFiles.length || S.creating) return;
    S.creating = true;
    S.createStep = 'Creating package…';
    render();
    try {
      const p = await call('POST', '/packages', {});
      replace(p);
      S.createStep = 'Uploading ' + S.newFiles.length + ' file(s)…';
      render();
      const fd = new FormData();
      S.newFiles.forEach(f => fd.append('files', f, f.name));
      const np = await call('POST', '/packages/' + p.id + '/documents', fd);
      replace(np);
      S.showNew = false;
      S.newFiles = [];
      S.selectedId = np.id;
      if (S.health && S.health.hasKey) await runReview(np);
    } catch (e) {
      fail(e, 'Could not create the package.');
    }
    S.creating = false;
    S.createStep = '';
    render();
  }

  async function runReview(p) {
    S.error = '';
    try { replace(await call('POST', '/packages/' + p.id + '/review', {})); } catch (e) { fail(e, 'Could not start the review.'); }
    render();
  }

  async function uploadTo(p, files) {
    const list = Array.from(files || []).filter(f => extOk(f.name));
    if (!list.length) return;
    const fd = new FormData();
    list.forEach(f => fd.append('files', f, f.name));
    S.uploading = true;
    render();
    try { replace(await call('POST', '/packages/' + p.id + '/documents', fd)); } catch (e) { fail(e, 'Upload failed.'); }
    S.uploading = false;
    render();
  }

  async function openDoc(p, docId) {
    // Fetch with the auth header, then show the file from a blob URL in a new tab.
    const win = window.open('', '_blank');
    try {
      const res = await fetch(API + '/packages/' + p.id + '/documents/' + docId + '/file', { headers: { Authorization: 'Bearer ' + token() } });
      if (!res.ok) throw new Error('Could not open the file (' + res.status + ')');
      const url = URL.createObjectURL(await res.blob());
      if (win) win.location = url; else window.open(url, '_blank');
      setTimeout(() => URL.revokeObjectURL(url), 60000);
    } catch (e) {
      if (win) win.close();
      fail(e, 'Could not open the file.');
    }
  }

  function addNewFiles(files) {
    const have = new Set(S.newFiles.map(f => f.name + f.size));
    Array.from(files || []).filter(f => extOk(f.name) && !have.has(f.name + f.size)).forEach(f => S.newFiles.push(f));
    render();
  }

  async function ask(q) {
    q = (q || '').trim();
    if (!q || S.asking) return;
    S.agentOpen = true;
    S.asking = true;
    const entry = { q, a: '' };
    S.asks.push(entry);
    renderAgent();
    try { entry.a = (await call('POST', '/ask', { question: q })).answer; } catch (e) { entry.a = e.message; entry.error = true; }
    S.asking = false;
    renderAgent();
  }

  document.addEventListener('click', async (ev) => {
    const el = ev.target.closest('[data-action]');
    if (!el) return;
    const a = el.dataset.action;
    const p = selected();
    switch (a) {
      case 'new': S.showNew = true; S.newFiles = []; S.error = ''; render(); break;
      case 'close-new': if (!S.creating) { S.showNew = false; render(); } break;
      case 'pick-new': $('newFiles').click(); break;
      case 'pick-folder': $('newFolder').click(); break;
      case 'remove-new': S.newFiles.splice(+el.dataset.i, 1); render(); break;
      case 'create': createPackage(); break;
      case 'filter': S.statusFilter = S.statusFilter === el.dataset.status ? '' : el.dataset.status; render(); break;
      case 'clear-status': S.statusFilter = ''; render(); break;
      case 'clear-search': S.search = ''; render(); break;
      case 'dismiss-error': S.error = ''; render(); break;
      case 'open': S.selectedId = +el.dataset.id; S.editing = false; render(); break;
      case 'close-drawer': S.selectedId = null; S.editing = false; render(); break;
      case 'edit': S.editing = true; renderOverlay(); break;
      case 'edit-cancel': S.editing = false; renderOverlay(); break;
      case 'pick-add': $('addFiles').click(); break;
      case 'open-doc': if (p) openDoc(p, el.dataset.doc); break;
      case 'remove-doc':
        if (p) { try { replace(await call('DELETE', '/packages/' + p.id + '/documents/' + el.dataset.doc)); } catch (e) { fail(e, 'Could not remove the file.'); } render(); }
        break;
      case 'review': if (p) runReview(p); break;
      case 'approve':
        if (p) { try { replace(await call('POST', '/packages/' + p.id + '/approve', {})); toast('Package approved for execution.'); } catch (e) { fail(e, 'Could not approve.'); } render(); }
        break;
      case 'ex-state':
        if (p) { try { replace(await call('PATCH', '/packages/' + p.id + '/exceptions/' + encodeURIComponent(el.dataset.ex), { state: el.dataset.state })); } catch (e) { fail(e, 'Could not update the finding.'); } render(); }
        break;
      case 'delete':
        if (p && confirm('Delete package "' + (p.number || p.title) + '" and its ' + p.documents.length + ' uploaded file(s)? This cannot be undone.')) {
          try { await call('DELETE', '/packages/' + p.id); S.packages = S.packages.filter(x => x.id !== p.id); S.selectedId = null; } catch (e) { fail(e, 'Could not delete the package.'); }
          render();
        }
        break;
      case 'agent-toggle': S.agentOpen = !S.agentOpen; renderAgent(); break;
      case 'agent-close': S.agentOpen = false; renderAgent(); break;
      case 'ask': ask(el.dataset.q); break;
      default: break;
    }
  });

  document.addEventListener('submit', async (ev) => {
    if (ev.target.id === 'composer') {
      ev.preventDefault();
      const q = $('question').value;
      $('question').value = '';
      ask(q);
    }
    if (ev.target.id === 'editForm') {
      ev.preventDefault();
      const p = selected();
      if (!p) return;
      const fd = new FormData(ev.target);
      const changed = {};
      META.forEach(k => { const v = String(fd.get(k) || ''); if (v !== p[k]) changed[k] = v; });
      S.editing = false;
      if (Object.keys(changed).length) {
        try { replace(await call('PATCH', '/packages/' + p.id, changed)); } catch (e) { fail(e, 'Could not save the details.'); }
      }
      render();
    }
  });

  document.addEventListener('input', (ev) => {
    if (ev.target.id === 'search') { S.search = ev.target.value; render(); }
  });

  $('newFiles').addEventListener('change', (ev) => { addNewFiles(ev.target.files); ev.target.value = ''; });
  $('newFolder').addEventListener('change', (ev) => { addNewFiles(ev.target.files); ev.target.value = ''; });
  $('addFiles').addEventListener('change', (ev) => { const p = selected(); if (p) uploadTo(p, ev.target.files); ev.target.value = ''; });

  // Drag and drop onto either drop zone.
  document.addEventListener('dragover', (ev) => {
    const z = ev.target.closest && ev.target.closest('#newDrop, #addDrop');
    if (z) { ev.preventDefault(); z.classList.add('over'); }
  });
  document.addEventListener('dragleave', (ev) => {
    const z = ev.target.closest && ev.target.closest('#newDrop, #addDrop');
    if (z) z.classList.remove('over');
  });
  document.addEventListener('drop', (ev) => {
    const z = ev.target.closest && ev.target.closest('#newDrop, #addDrop');
    if (!z) return;
    ev.preventDefault();
    if (z.id === 'newDrop') addNewFiles(ev.dataTransfer.files);
    else { const p = selected(); if (p) uploadTo(p, ev.dataTransfer.files); }
  });

  // Poll while a review runs (or the server is unreachable); tick the elapsed timers.
  setInterval(() => {
    if (S.offline || S.packages.some(p => p.reviewStatus === 'reviewing')) refresh();
  }, 4000);
  setInterval(() => {
    S.now = Date.now();
    if (S.packages.some(p => p.reviewStatus === 'reviewing')) render();
  }, 1000);

  refresh();
})();
