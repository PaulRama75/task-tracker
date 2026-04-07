// ─── Image Compression ────────────────────────────────────────────────────
function compressImage(file, maxW, maxH, quality) {
    return new Promise((resolve) => {
        const reader = new FileReader();
        reader.onload = (e) => {
            const img = new Image();
            img.onload = () => {
                let w = img.width, h = img.height;
                if (w > maxW || h > maxH) {
                    const ratio = Math.min(maxW / w, maxH / h);
                    w = Math.round(w * ratio); h = Math.round(h * ratio);
                }
                const canvas = document.createElement('canvas');
                canvas.width = w; canvas.height = h;
                canvas.getContext('2d').drawImage(img, 0, 0, w, h);
                resolve(canvas.toDataURL('image/jpeg', quality));
            };
            img.onerror = () => resolve(e.target.result);
            img.src = e.target.result;
        };
        reader.readAsDataURL(file);
    });
}

// ─── Main App ─────────────────────────────────────────────────────────────
const App = (() => {
    let currentReport = null;
    let lockRefreshInterval = null;
    let dirty = false;
    const quillEditors = new Map();
    let viewingVersion = null;

    const $ = (sel) => document.querySelector(sel);
    const $$ = (sel) => document.querySelectorAll(sel);

    function toast(msg, type = 'info') {
        let c = $('.toast-container');
        if (!c) { c = document.createElement('div'); c.className = 'toast-container'; document.body.appendChild(c); }
        const t = document.createElement('div'); t.className = `toast ${type}`; t.textContent = msg;
        c.appendChild(t); setTimeout(() => t.remove(), 4000);
    }

    function markDirty() {
        dirty = true;
        const s = $('#save-status'); if (s) s.textContent = 'Unsaved changes';
    }

    // Migrate plain text content to HTML
    function toHtml(content) {
        if (!content) return '';
        if (content.trim().startsWith('<')) return content;
        return '<p>' + content.replace(/\n/g, '<br>') + '</p>';
    }

    function esc(str) { if (!str) return ''; const d = document.createElement('div'); d.textContent = str; return d.innerHTML; }

    // ─── Init ─────────────────────────────────────────────────────────────
    async function init() {
        try { migratePhotos(); } catch(e) { console.error('migratePhotos error:', e); }

        let user = null;
        try {
            user = await Auth.init();
        } catch(e) {
            console.error('Auth.init error:', e);
        }

        // Always show UI - auth comes from parent task-tracker
        $('#login-modal').classList.add('hidden');
        $('#top-bar').classList.remove('hidden');
        $('#report-container').classList.remove('hidden');

        if (user) {
            showApp(user);
        } else {
            $('#user-info').textContent = 'Not authenticated';
            $('#report-content').innerHTML = '<div style="text-align:center;padding:80px 20px;color:#888;"><h2 style="color:#ccc;margin-bottom:12px;">Authentication Required</h2><p>Please log in to the main application first, then switch to Reports.</p></div>';
        }

        try { bindEvents(); } catch(e) { console.error('bindEvents error:', e); }
    }

    async function migratePhotos() {
        const raw = localStorage.getItem('tir_data');
        if (!raw) return;
        const data = JSON.parse(raw); let changed = false;
        for (const report of (data.reports || [])) {
            for (const photo of (report.photos || [])) {
                if (photo.dataUrl && photo.dataUrl.length > 100000) {
                    try {
                        const compressed = await new Promise((resolve) => {
                            const img = new Image();
                            img.onload = () => {
                                let w = img.width, h = img.height;
                                const r = Math.min(800 / w, 600 / h, 1);
                                w = Math.round(w * r); h = Math.round(h * r);
                                const c = document.createElement('canvas'); c.width = w; c.height = h;
                                c.getContext('2d').drawImage(img, 0, 0, w, h);
                                resolve(c.toDataURL('image/jpeg', 0.7));
                            };
                            img.onerror = () => resolve(null);
                            img.src = photo.dataUrl;
                        });
                        if (compressed && compressed.length < photo.dataUrl.length) { photo.dataUrl = compressed; changed = true; }
                    } catch (e) {}
                }
            }
        }
        if (changed) localStorage.setItem('tir_data', JSON.stringify(data));
    }

    function showLogin() {
        $('#login-modal').classList.remove('hidden');
        $('#top-bar').classList.add('hidden');
        $('#report-container').classList.add('hidden');
        $('#library-container').classList.add('hidden');
    }

    function showApp(user) {
        $('#login-modal').classList.add('hidden');
        $('#top-bar').classList.remove('hidden');
        $('#user-info').textContent = `${user.name} (${user.role})`;
        $('#btn-admin').classList.toggle('hidden', !user.is_admin);
        $('#btn-import-portal').classList.toggle('hidden', !user.is_admin);
        // Hide logout button when running inside task-tracker iframe
        if (Auth.isInIframe()) {
            $('#btn-logout').style.display = 'none';
        }
        loadSiteSelector();
        loadReportList();
        // Show Library as default landing page
        Library.show();
    }

    // ─── Site Selector ────────────────────────────────────────────────────
    function loadSiteSelector() {
        const user = Auth.getUser();
        if (!user) return;
        const sites = API.getUserSites(user.id);
        const select = $('#site-selector');
        const currentVal = select.value;
        select.innerHTML = '<option value="">-- All Sites --</option>';
        sites.forEach(s => {
            const opt = document.createElement('option');
            opt.value = s.id;
            opt.textContent = s.client_name ? `${s.client_name} - ${s.plant_name}` : s.plant_name;
            select.appendChild(opt);
        });
        // Auto-select: restore previous selection, or if user has exactly one site, select it
        if (currentVal) {
            select.value = currentVal;
        } else if (sites.length === 1) {
            select.value = sites[0].id;
        }
    }

    function parseSiteId(raw) {
        if (!raw && raw !== 0) return null;
        const n = parseInt(raw);
        return isNaN(n) ? raw : n;
    }

    function getSelectedSiteId() {
        const val = $('#site-selector').value;
        return val ? parseSiteId(val) : null;
    }

    function loadReportList() {
        let reports = API.getReports();
        const siteId = getSelectedSiteId();
        const user = Auth.getUser();

        // Filter by site: if site selected, show only that site's reports
        // If no site selected and not admin, show only user's sites' reports
        if (siteId) {
            reports = reports.filter(r => r.site_id === siteId);
        } else if (user && !user.is_admin && user.site_ids && user.site_ids.length) {
            reports = reports.filter(r => !r.site_id || user.site_ids.includes(r.site_id));
        }

        const select = $('#report-selector');
        select.innerHTML = '<option value="">-- Select Report --</option>';
        const sites = API.getSites();
        reports.forEach(r => {
            const opt = document.createElement('option');
            opt.value = r.id;
            const typeLabels = { tower: 'TWR', exchanger: 'EXC', aircooler: 'AC', drum: 'DRM', heater: 'HTR', ext510: '510', ext570: '570' };
            const typeLabel = typeLabels[r.report_type || 'tower'] || 'TWR';
            const site = sites.find(s => s.id === r.site_id);
            const siteTag = site ? `${site.plant_name} | ` : '';
            opt.textContent = `[${typeLabel}] ${siteTag}${r.equipment_number || '?'} - ${r.project_name || 'Draft'} [${r.status}]`;
            select.appendChild(opt);
        });
        if (currentReport) select.value = currentReport.id;
    }

    // ─── Load Report ──────────────────────────────────────────────────────
    function loadReport(reportId, options) {
        const skipAutoLock = options && options.skipAutoLock;
        destroyQuills();
        viewingVersion = null;
        $('#version-banner').classList.add('hidden');

        if (!reportId) {
            currentReport = null;
            document.title = 'Inspection Report System';
            $('#report-container').classList.remove('hidden');
            $('#report-content').innerHTML = '<div style="text-align:center;padding:80px 20px;color:#888;"><h2 style="color:#ccc;margin-bottom:12px;">No Report Selected</h2><p>Select a report from the dropdown above or click <strong>+ New Report</strong> to create one.</p></div>';
            updateLockUI(); return;
        }
        const report = API.getReport(parseInt(reportId));
        if (!report) { toast('Report not found', 'error'); return; }
        currentReport = report;
        dirty = false;
        $('#report-container').classList.remove('hidden');
        $('#library-container').classList.add('hidden');

        // Auto-claim edit lock (before rendering so all sections get editors)
        if (!skipAutoLock && !Auth.hasLock(currentReport)) {
            try {
                Auth.acquireLock(currentReport.id);
                currentReport = API.getReport(currentReport.id);
            } catch(e) { console.warn('Auto-lock failed:', e.message); }
        }

        // Set title based on report type
        const config = API.getReportTypeConfig(currentReport.report_type || 'tower');
        const eqNumTitle = currentReport.equipment_number || 'Report';
        document.title = `${eqNumTitle} - ${config.title || 'Inspection Report'}`;
        const headerDiv = $('.report-header');
        const isExtReport = currentReport.report_type === 'ext510' || currentReport.report_type === 'ext570';
        const eqNum = currentReport.equipment_number || '';
        const formNum = config.formNumber || 'FER-PROJ-FORM-01';
        const idLabel = config.idLabel || 'EQUIPMENT ID';
        headerDiv.className = 'report-header ext510-header';
        headerDiv.innerHTML = `
            <div class="ext510-header-block">
                <div class="ext510-logo"><img src="images/fer-logo.png" alt="FER"></div>
                <div class="ext510-title-area">
                    <h1>${esc(config.title)}</h1>
                </div>
                <div class="ext510-meta-area">
                    <div class="ext510-meta">${esc(formNum)}</div>
                    <div class="ext510-meta">Issue Date: 08/07/2025</div>
                    <div class="ext510-meta">Revision Date: 04/02/2026</div>
                </div>
            </div>
            <div class="ext510-equip-id">${esc(idLabel)}: <span>${esc(eqNum)}</span></div>
        `;

        // Build dynamic equipment table
        buildEquipmentTable(config);

        // Build 510 inspector info
        build510InspectorInfo(config);

        // Build checklist section (510 EXT)
        buildChecklistSection(config);

        // Build dynamic narrative sections
        buildNarrativeSections(config);

        renderHeaderSection();
        renderOrientPhotos();

        // Remove forced page break on orientation photos (let content flow naturally)
        const orientSection = document.querySelector('[data-section="orientation_photos"]');
        if (orientSection) {
            orientSection.classList.remove('ext510-page-break-before');
        }

        // Hide inspection type checkboxes for ext reports (always external)
        const inspectionSection = document.querySelector('[data-section="inspection_type"]');
        if (inspectionSection) {
            inspectionSection.classList.toggle('hidden', isExtReport);
        }
        if (!isExtReport) {
            renderInspectionType();
        }

        render510InspectorInfo();
        renderChecklist();
        renderNarrativeSections();
        renderPhotos();
        renderRejectionBanner();
        updateLockUI();
    }

    // ─── Rejection Banner ─────────────────────────────────────────────────
    function renderRejectionBanner() {
        let banner = $('#rejection-banner');
        if (!banner) {
            banner = document.createElement('div');
            banner.id = 'rejection-banner';
            banner.className = 'rejection-banner hidden';
            const reportContent = $('#report-content');
            reportContent.insertBefore(banner, reportContent.querySelector('.report-section'));
        }

        if (currentReport && currentReport.rejection) {
            const r = currentReport.rejection;
            banner.classList.remove('hidden');
            banner.innerHTML = `
                <div class="rejection-icon">&#9888;</div>
                <div class="rejection-body">
                    <strong>Report Rejected by ${esc(r.rejected_by_name)}</strong>
                    <span class="rejection-date">${new Date(r.rejected_at).toLocaleString()}</span>
                    <div class="rejection-reason">${esc(r.reason)}</div>
                </div>
                <button class="btn btn-sm" onclick="document.getElementById('rejection-banner').classList.add('hidden')">Dismiss</button>
            `;
        } else {
            banner.classList.add('hidden');
            banner.innerHTML = '';
        }
    }

    // ─── Version Viewing ──────────────────────────────────────────────────
    function viewVersion(version) {
        viewingVersion = version;
        destroyQuills();

        // Temporarily replace sections
        const fakeReport = { ...currentReport, sections: version.section_snapshots, lock: null };
        const realReport = currentReport;
        currentReport = fakeReport;

        renderHeaderSection();
        renderOrientPhotos();
        if (currentReport.report_type !== 'ext510') {
            renderInspectionType();
        }
        render510InspectorInfo();
        renderChecklist();
        renderNarrativeSections();

        currentReport = realReport;

        // Show banner
        const banner = $('#version-banner');
        banner.classList.remove('hidden');
        $('#version-banner-text').textContent = `Viewing Version #${version.version_id} from ${new Date(version.timestamp).toLocaleString()} by ${version.user_name}`;

        // Hide save bar
        $('#save-bar').classList.add('hidden');
    }

    // ─── Render: Header ───────────────────────────────────────────────────
    // ─── Build Dynamic Equipment Table ──────────────────────────────────
    function buildEquipmentTable(config) {
        const container = $('#equipment-table-container');

        if (config.checklistCategories) {
            let tableHtml;
            if (currentReport.report_type === 'ext570') {
                // 570 EXT piping layout
                tableHtml = `
                <table class="info-table ext510-equip-table" id="equipment-table">
                    <tr>
                        <td class="label ext510-tbl-hdr">UNIT #</td>
                        <td class="label ext510-tbl-hdr" colspan="2">SYSTEM / CIRCUIT #</td>
                        <td class="label ext510-tbl-hdr" colspan="2">DESCRIPTION</td>
                    </tr>
                    <tr>
                        <td class="value" data-field="unit_number"></td>
                        <td class="value" data-field="equipment_number" colspan="2"></td>
                        <td class="value" data-field="description" colspan="2"></td>
                    </tr>
                    <tr>
                        <td class="label ext510-tbl-hdr">LINE #</td>
                        <td class="label ext510-tbl-hdr">MATERIAL</td>
                        <td class="label ext510-tbl-hdr">PIPE SPEC</td>
                        <td class="label ext510-tbl-hdr" colspan="2">SYSTEM/SERVICE</td>
                    </tr>
                    <tr>
                        <td class="value" data-field="line_number"></td>
                        <td class="value" data-field="material"></td>
                        <td class="value" data-field="pipe_spec"></td>
                        <td class="value" data-field="system_service" colspan="2"></td>
                    </tr>
                    <tr>
                        <td class="label ext510-tbl-hdr">DESIGN PRESSURE</td>
                        <td class="label ext510-tbl-hdr">DESIGN TEMP.</td>
                        <td class="label ext510-tbl-hdr">OPER. PRESSURE</td>
                        <td class="label ext510-tbl-hdr">OPER. TEMP.</td>
                        <td class="label ext510-tbl-hdr">P&amp;ID</td>
                    </tr>
                    <tr>
                        <td class="value ext510-unit-row"><span data-field="design_pressure"></span> PSIG</td>
                        <td class="value ext510-unit-row"><span data-field="design_temp"></span> &deg;F</td>
                        <td class="value ext510-unit-row"><span data-field="oper_pressure"></span> PSIG</td>
                        <td class="value ext510-unit-row"><span data-field="oper_temp"></span> &deg;F</td>
                        <td class="value" data-field="p_and_id"></td>
                    </tr>
                </table>`;
            } else {
                // 510 EXT vessel layout
                tableHtml = `
                <table class="info-table ext510-equip-table" id="equipment-table">
                    <tr>
                        <td class="label ext510-tbl-hdr" colspan="1">UNIT #</td>
                        <td class="label ext510-tbl-hdr" colspan="2">EQUIPMENT #</td>
                        <td class="label ext510-tbl-hdr" colspan="2">DESCRIPTION</td>
                    </tr>
                    <tr>
                        <td class="value" data-field="unit_number" colspan="1"></td>
                        <td class="value" data-field="equipment_number" colspan="2"></td>
                        <td class="value" data-field="description" colspan="2"></td>
                    </tr>
                    <tr>
                        <td class="label ext510-tbl-hdr">SERIAL#</td>
                        <td class="label ext510-tbl-hdr">NATIONAL BD#</td>
                        <td class="label ext510-tbl-hdr">YEAR BUILT</td>
                        <td class="label ext510-tbl-hdr">PWHT</td>
                        <td class="label ext510-tbl-hdr">SYSTEM/SERVICE</td>
                    </tr>
                    <tr>
                        <td class="value" data-field="nb_serial_number"></td>
                        <td class="value" data-field="national_bd_number"></td>
                        <td class="value" data-field="year_built"></td>
                        <td class="value" data-field="pwht"></td>
                        <td class="value" data-field="system_service"></td>
                    </tr>
                    <tr>
                        <td class="label ext510-tbl-hdr">DESIGN PRESSURE</td>
                        <td class="label ext510-tbl-hdr">DESIGN TEMP.</td>
                        <td class="label ext510-tbl-hdr">OPER. PRESSURE</td>
                        <td class="label ext510-tbl-hdr">OPER. TEMP.</td>
                        <td class="label ext510-tbl-hdr">P&amp;ID</td>
                    </tr>
                    <tr>
                        <td class="value ext510-unit-row"><span data-field="design_pressure"></span> PSIG</td>
                        <td class="value ext510-unit-row"><span data-field="design_temp"></span> &deg;F</td>
                        <td class="value ext510-unit-row"><span data-field="oper_pressure"></span> PSIG</td>
                        <td class="value ext510-unit-row"><span data-field="oper_temp"></span> &deg;F</td>
                        <td class="value" data-field="p_and_id"></td>
                    </tr>
                </table>`;
            }
            container.innerHTML = tableHtml;
            // Hide the default fixed header table for ext reports
            const fixedHeader = $('#header-table');
            if (fixedHeader) fixedHeader.classList.add('hidden');
            return;
        }

        // Default layout for other report types
        const fixedHeader = $('#header-table');
        if (fixedHeader) fixedHeader.classList.remove('hidden');
        let html = '<table class="info-table" id="equipment-table">';
        config.headerFields.forEach(row => {
            html += '<tr>';
            if (row[2] !== null) {
                html += `<td class="label">${row[0]}</td><td class="value" data-field="${row[1]}"></td>`;
                html += `<td class="label">${row[2]}</td><td class="value" data-field="${row[3]}"></td>`;
            } else {
                html += `<td class="label">${row[0]}</td><td class="value" data-field="${row[1]}" colspan="3"></td>`;
            }
            html += '</tr>';
        });
        html += '</table>';
        container.innerHTML = html;
    }

    // ─── Build 510 Inspector Info Table ─────────────────────────────────────
    function build510InspectorInfo(config) {
        const container = $('#ext510-inspector-container');
        if (!config.checklistCategories) {
            container.innerHTML = '';
            container.classList.add('hidden');
            return;
        }
        container.classList.remove('hidden');
        container.innerHTML = `
            <section class="report-section" data-section="ext510_inspector">
                <div class="section-view">
                    <table class="info-table ext510-inspector-table">
                        <tr>
                            <td class="label ext510-insp-label">INSPECTOR NAME</td>
                            <td class="value" data-field="ext510_inspector_name"></td>
                            <td class="label ext510-insp-label">API #</td>
                            <td class="value" data-field="ext510_api_number"></td>
                        </tr>
                        <tr>
                            <td class="label ext510-insp-label">INSPECTOR SIGNATURE</td>
                            <td class="value" data-field="ext510_inspector_signature"></td>
                            <td class="label ext510-insp-label">DATE</td>
                            <td class="value" data-field="ext510_inspector_date"></td>
                        </tr>
                    </table>
                </div>
            </section>
        `;
    }

    function render510InspectorInfo() {
        const config = API.getReportTypeConfig(currentReport.report_type || 'tower');
        if (!config.checklistCategories) return;
        const data = viewingVersion
            ? ((viewingVersion.section_snapshots.ext510_inspector || {}).section_data || {})
            : getSectionData('ext510_inspector');
        const hasLock = !viewingVersion && Auth.hasLock(currentReport);

        $$('[data-section="ext510_inspector"] [data-field]').forEach(td => {
            const key = td.dataset.field;
            const val = data[key] || '';
            if (hasLock) {
                const inputType = key === 'ext510_inspector_date' ? 'date' : 'text';
                td.innerHTML = `<input type="${inputType}" class="inline-input" data-skey="ext510_inspector" data-fkey="${key}" value="${esc(val)}">`;
            } else {
                td.textContent = val;
            }
        });
    }

    // ─── Build Checklist Section (510 EXT) ─────────────────────────────────
    function buildChecklistSection(config) {
        const container = $('#checklist-section-container');
        if (!config.checklistCategories) {
            container.innerHTML = '';
            container.classList.add('hidden');
            return;
        }
        container.classList.remove('hidden');
        let html = '<section class="report-section" data-section="checklist"><div class="section-view">';
        html += `<div class="cl-toolbar hidden" id="cl-format-toolbar">
            <button type="button" data-cmd="bold" title="Bold (Ctrl+B)"><b>B</b></button>
            <button type="button" data-cmd="italic" title="Italic (Ctrl+I)"><i>I</i></button>
            <button type="button" data-cmd="underline" title="Underline (Ctrl+U)"><u>U</u></button>
            <button type="button" data-cmd="insertUnorderedList" title="Bullet List">&#8226;</button>
            <button type="button" data-cmd="foreColor" data-val="#e74c3c" title="Red Text" style="color:#e74c3c;"><b>A</b></button>
            <button type="button" data-cmd="removeFormat" title="Clear Formatting">&#10005;</button>
        </div>`;
        html += '<table class="checklist-table"><thead><tr>';
        html += '<th class="cl-cat-col">Category</th><th class="cl-item-col">Item</th>';
        html += '<th class="cl-check-col">Yes</th><th class="cl-check-col">No</th><th class="cl-check-col">N/A</th>';
        html += '<th class="cl-loc-col">Location = (V#)</th><th class="cl-comment-col">Comments</th>';
        html += '</tr></thead><tbody>';
        config.checklistCategories.forEach(cat => {
            cat.items.forEach((item, idx) => {
                html += `<tr data-cl-num="${item.num}">`;
                if (idx === 0) {
                    html += `<td class="cl-cat-cell" rowspan="${cat.items.length}"><strong>${esc(cat.title)}</strong></td>`;
                }
                html += `<td class="cl-item-cell">${esc(item.label)}</td>`;
                html += `<td class="cl-check-cell"><span class="cl-checkbox" data-cl-num="${item.num}" data-cl-val="yes"></span></td>`;
                html += `<td class="cl-check-cell"><span class="cl-checkbox" data-cl-num="${item.num}" data-cl-val="no"></span></td>`;
                html += `<td class="cl-check-cell"><span class="cl-checkbox" data-cl-num="${item.num}" data-cl-val="na"></span></td>`;
                html += `<td class="cl-loc-cell"><span class="cl-text" data-cl-num="${item.num}" data-cl-field="location"></span></td>`;
                html += `<td class="cl-comment-cell"><div class="cl-comment" data-cl-num="${item.num}" data-cl-field="comments"></div></td>`;
                html += '</tr>';
            });
        });
        html += '</tbody></table></div></section>';
        container.innerHTML = html;
    }

    function renderChecklist() {
        const config = API.getReportTypeConfig(currentReport.report_type || 'tower');
        if (!config.checklistCategories) return;
        const data = viewingVersion
            ? ((viewingVersion.section_snapshots.checklist || {}).section_data || {})
            : getSectionData('checklist');
        const items = data.items || {};
        const hasLock = !viewingVersion && Auth.hasLock(currentReport);

        // Render checkboxes
        $$('.cl-checkbox').forEach(el => {
            const num = el.dataset.clNum;
            const val = el.dataset.clVal;
            const itemData = items[num] || {};
            const isChecked = itemData.value === val;
            el.classList.toggle('checked', isChecked);
            el.textContent = isChecked ? '☒' : '☐';
            if (hasLock) {
                el.style.cursor = 'pointer';
                el.onclick = () => {
                    // Toggle: if already checked, uncheck; else set this value
                    const wasChecked = el.classList.contains('checked');
                    // Uncheck all in same row
                    $$(`[data-cl-num="${num}"].cl-checkbox`).forEach(cb => {
                        cb.classList.remove('checked');
                        cb.textContent = '☐';
                    });
                    if (!wasChecked) {
                        el.classList.add('checked');
                        el.textContent = '☒';
                    }
                    markDirty();
                };
            } else {
                el.style.cursor = 'default';
                el.onclick = null;
            }
        });

        // Render location (plain text)
        $$('.cl-text').forEach(el => {
            const num = el.dataset.clNum;
            const field = el.dataset.clField;
            const itemData = items[num] || {};
            if (hasLock) {
                el.innerHTML = `<input type="text" class="cl-input" data-cl-num="${num}" data-cl-field="${field}" value="${esc(itemData[field] || '')}">`;
            } else {
                el.textContent = itemData[field] || '';
            }
        });

        // Render comments (rich text)
        $$('.cl-comment').forEach(el => {
            const num = el.dataset.clNum;
            const itemData = items[num] || {};
            const content = itemData.comments || '';
            if (hasLock) {
                el.contentEditable = 'true';
                el.classList.add('cl-comment-editable');
                el.innerHTML = content;
                el.addEventListener('input', markDirty);
                el.addEventListener('paste', (e) => {
                    e.preventDefault();
                    const text = e.clipboardData.getData('text/html') || e.clipboardData.getData('text/plain');
                    document.execCommand('insertHTML', false, text);
                });
            } else {
                el.contentEditable = 'false';
                el.innerHTML = content;
            }
        });

        // Mark dirty on input
        $$('.cl-input').forEach(inp => {
            inp.addEventListener('input', markDirty);
        });

        // Toolbar for rich text comments
        const toolbar = $('#cl-format-toolbar');
        if (toolbar && hasLock) {
            toolbar.classList.remove('hidden');
            toolbar.querySelectorAll('button').forEach(btn => {
                btn.onmousedown = (e) => {
                    e.preventDefault(); // keep focus on contenteditable
                    const cmd = btn.dataset.cmd;
                    const val = btn.dataset.val || null;
                    document.execCommand(cmd, false, val);
                    markDirty();
                };
            });
        } else if (toolbar) {
            toolbar.classList.add('hidden');
        }
    }

    function collectChecklistData() {
        const items = {};
        // Collect checkbox values
        $$('.cl-checkbox.checked').forEach(el => {
            const num = el.dataset.clNum;
            if (!items[num]) items[num] = {};
            items[num].value = el.dataset.clVal;
        });
        // Collect text inputs (location)
        $$('.cl-input').forEach(inp => {
            const num = inp.dataset.clNum;
            const field = inp.dataset.clField;
            if (!items[num]) items[num] = {};
            items[num][field] = inp.value;
        });
        // Collect rich text comments
        $$('.cl-comment').forEach(el => {
            const num = el.dataset.clNum;
            if (!items[num]) items[num] = {};
            items[num].comments = el.innerHTML.trim();
        });
        return { items };
    }

    // ─── Build Dynamic Narrative Sections ─────────────────────────────────
    function buildNarrativeSections(config) {
        const sectionHtml = config.narrativeSections.map(s =>
            `<section class="report-section" data-section="${s.key}">
                <div class="section-view"><h3>${s.title}</h3><div class="narrative-wrap" data-field="content"></div></div>
            </section>`
        ).join('');

        // For 510 EXT, place narrative sections after inspector info (before checklist)
        const ext510Container = $('#ext510-narrative-container');
        const defaultContainer = $('#narrative-sections-container');
        if (config.checklistCategories) {
            ext510Container.classList.remove('hidden');
            ext510Container.innerHTML = sectionHtml;
            defaultContainer.innerHTML = '';
        } else {
            ext510Container.classList.add('hidden');
            ext510Container.innerHTML = '';
            defaultContainer.innerHTML = sectionHtml;
        }
    }

    function renderHeaderSection() {
        const data = getSectionData('header');
        const hasLock = !viewingVersion && Auth.hasLock(currentReport);
        const isExtReport = currentReport.report_type === 'ext510' || currentReport.report_type === 'ext570';

        $$('[data-section="header"] [data-field]').forEach(el => {
            const key = el.dataset.field;
            const val = data[key] || '';
            if (hasLock) {
                el.innerHTML = `<input type="text" class="inline-input" data-skey="header" data-fkey="${key}" value="${esc(val)}">`;
            } else {
                el.textContent = val;
            }
        });

        // EXT reports: also render fields inside equipment-table (spans & tds)
        if (isExtReport) {
            $$('#equipment-table [data-field]').forEach(el => {
                const key = el.dataset.field;
                const val = data[key] || '';
                const isSpan = el.tagName === 'SPAN';
                if (hasLock) {
                    el.innerHTML = `<input type="text" class="inline-input" data-skey="header" data-fkey="${key}" value="${esc(val)}" style="${isSpan ? 'width:60px;display:inline;' : ''}">`;
                } else {
                    el.textContent = val;
                }
            });
        }
    }

    // ─── Render: Orientation Photos ───────────────────────────────────────
    function renderOrientPhotos() {
        const data = viewingVersion
            ? ((viewingVersion.section_snapshots.orientation_photos || {}).section_data || {})
            : getSectionData('orientation_photos');
        const hasLock = !viewingVersion && Auth.hasLock(currentReport);
        const orientBox = $('#orientation-img');
        const dataplateBox = $('#dataplate-img');

        orientBox.innerHTML = data.orientation_photo
            ? `<img src="${data.orientation_photo}" alt="Orientation">`
            : '<span class="orient-placeholder">Click to upload</span>';
        dataplateBox.innerHTML = data.dataplate_photo
            ? `<img src="${data.dataplate_photo}" alt="Data Plate">`
            : '<span class="orient-placeholder">Click to upload</span>';

        $$('.photo-file-input').forEach(el => el.classList.toggle('hidden', !hasLock));
        orientBox.style.cursor = hasLock ? 'pointer' : 'default';
        dataplateBox.style.cursor = hasLock ? 'pointer' : 'default';
        orientBox.onclick = hasLock ? () => $('#orient-file').click() : null;
        dataplateBox.onclick = hasLock ? () => $('#dataplate-file').click() : null;
    }

    // ─── Render: Inspection Type ──────────────────────────────────────────
    function renderInspectionType() {
        const data = viewingVersion
            ? ((viewingVersion.section_snapshots.inspection_type || {}).section_data || {})
            : getSectionData('inspection_type');
        const hasLock = !viewingVersion && Auth.hasLock(currentReport);

        const intCheck = $('[data-field="internal_inspection"]');
        const extCheck = $('[data-field="external_inspection_check"]');
        if (intCheck) intCheck.classList.toggle('checked', !!data.internal_inspection);
        if (extCheck) extCheck.classList.toggle('checked', !!data.external_inspection_check);

        if (hasLock) {
            intCheck.style.cursor = 'pointer';
            extCheck.style.cursor = 'pointer';
            intCheck.onclick = () => { intCheck.classList.toggle('checked'); markDirty(); };
            extCheck.onclick = () => { extCheck.classList.toggle('checked'); markDirty(); };
        } else {
            intCheck.style.cursor = 'default'; extCheck.style.cursor = 'default';
            intCheck.onclick = null; extCheck.onclick = null;
        }

        const tbody = $('[data-field="inspectors"]');
        const inspectors = data.inspectors || [];
        tbody.innerHTML = inspectors.length === 0
            ? '<tr><td colspan="3" style="text-align:center;color:#aaa;font-style:italic;">No inspectors added</td></tr>'
            : inspectors.map(i => `<tr><td>${esc(i.name || '')}</td><td>${esc(i.api_cert || '')}</td><td>${esc(i.date || '')}</td></tr>`).join('');

        const editArea = $('#inspector-edit-area');
        if (hasLock) {
            editArea.classList.remove('hidden');
            const list = $('#inspectors-edit-list');
            list.innerHTML = '';
            const insps = inspectors.length ? inspectors : [{}];
            insps.forEach((insp, i) => {
                list.insertAdjacentHTML('beforeend', `<div class="inspector-edit-row" data-idx="${i}">
                    <input type="text" data-insp="name" value="${esc(insp.name || '')}" placeholder="Inspector Name">
                    <input type="text" data-insp="api_cert" value="${esc(insp.api_cert || '')}" placeholder="API Cert #">
                    <input type="date" data-insp="date" value="${esc(insp.date || '')}">
                    <button type="button" class="btn btn-sm btn-danger btn-remove-inspector">&times;</button>
                </div>`);
            });
            bindRemoveInspector(list);
        } else {
            editArea.classList.add('hidden');
        }
    }

    // ─── Render: Narrative Sections (Quill) ───────────────────────────────
    function renderNarrativeSections() {
        const hasLock = !viewingVersion && Auth.hasLock(currentReport);
        const config = API.getReportTypeConfig(currentReport.report_type || 'tower');
        const keys = config.narrativeSections.map(s => s.key);

        keys.forEach(key => {
            const section = $(`[data-section="${key}"]`);
            if (!section) return;

            let data;
            if (viewingVersion) {
                data = ((viewingVersion.section_snapshots[key] || {}).section_data || {});
            } else {
                data = getSectionData(key);
            }

            const wrap = section.querySelector('.narrative-wrap');
            if (!wrap) return;
            const htmlContent = toHtml(data.content || '');

            if (hasLock) {
                // Create Quill editor
                wrap.innerHTML = `<div id="quill-${key}"></div>`;
                const quill = new Quill(`#quill-${key}`, {
                    theme: 'snow',
                    modules: {
                        toolbar: [
                            [{ header: [1, 2, 3, false] }],
                            ['bold', 'italic', 'underline'],
                            [{ color: [] }],
                            [{ list: 'ordered' }, { list: 'bullet' }],
                            ['image', 'clean'],
                        ],
                    },
                    placeholder: 'Type here...',
                });
                quill.root.innerHTML = htmlContent;
                quill.on('text-change', markDirty);
                quillEditors.set(key, quill);

                // Custom image handler — compress before inserting
                quill.getModule('toolbar').addHandler('image', () => {
                    const input = document.createElement('input');
                    input.type = 'file'; input.accept = 'image/*';
                    input.onchange = async () => {
                        const file = input.files[0]; if (!file) return;
                        const dataUrl = await compressImage(file, 400, 300, 0.6);
                        const range = quill.getSelection(true);
                        quill.insertEmbed(range.index, 'image', dataUrl);
                    };
                    input.click();
                });
            } else {
                wrap.innerHTML = `<div class="narrative">${htmlContent || ''}</div>`;
            }
        });
    }

    function destroyQuills() {
        quillEditors.forEach((q, key) => {
            const container = $(`#quill-${key}`);
            if (container) container.innerHTML = '';
        });
        quillEditors.clear();
    }

    // ─── Render: Photos ───────────────────────────────────────────────────
    function renderPhotos() {
        const grid = $('#photo-grid');
        const photos = currentReport.photos || [];
        const hasLock = !viewingVersion && Auth.hasLock(currentReport);
        const uploadArea = $('#photo-upload-area');
        if (uploadArea) uploadArea.classList.toggle('hidden', !hasLock);

        if (photos.length === 0) {
            grid.innerHTML = '<p style="color:#aaa;font-style:italic;grid-column:1/-1;text-align:center;">No photos uploaded yet.</p>';
            return;
        }

        grid.innerHTML = photos.map(p => `
            <div class="photo-card" data-photo-id="${p.id}">
                <img src="${p.dataUrl || p.filepath}" alt="${esc(p.caption || '')}">
                <div class="photo-caption-area">
                    <input type="text" class="caption-input" data-photo-id="${p.id}" value="${esc(p.caption || '')}" placeholder="Add description..." ${hasLock ? '' : 'readonly'}>
                </div>
                ${hasLock ? '<button class="photo-delete" title="Delete">&times;</button>' : ''}
            </div>
        `).join('');

        grid.querySelectorAll('.photo-delete').forEach(btn => {
            btn.addEventListener('click', () => {
                API.deletePhoto(currentReport.id, parseInt(btn.closest('.photo-card').dataset.photoId));
                currentReport = API.getReport(currentReport.id);
                renderPhotos(); toast('Photo deleted', 'info');
            });
        });
        grid.querySelectorAll('.caption-input').forEach(inp => {
            inp.addEventListener('change', () => {
                const data = JSON.parse(localStorage.getItem('tir_data'));
                const report = data.reports.find(r => r.id === currentReport.id);
                const photo = (report.photos || []).find(p => p.id === parseInt(inp.dataset.photoId));
                if (photo) { photo.caption = inp.value; localStorage.setItem('tir_data', JSON.stringify(data)); }
            });
        });
    }

    // ─── Render: Attachments ─────────────────────────────────────────────
    function renderAttachments() {
        const list = $('#attachments-list');
        const attachments = currentReport.attachments || [];
        const hasLock = !viewingVersion && Auth.hasLock(currentReport);
        const uploadArea = $('#attachment-upload-area');
        if (uploadArea) uploadArea.classList.toggle('hidden', !hasLock);

        if (attachments.length === 0) {
            list.innerHTML = '<p style="color:#aaa;font-style:italic;text-align:center;padding:12px;">No documents attached. Use "+ Add Files" to upload images, PDFs, or documents.</p>';
            return;
        }

        list.innerHTML = `<table class="att-table">
            <thead><tr><th>File</th><th>Type</th><th>Uploaded By</th><th>Date</th><th>Actions</th></tr></thead>
            <tbody>${attachments.map(a => {
                const isImage = a.file_type && a.file_type.startsWith('image/');
                const isPdf = a.file_type && a.file_type.includes('pdf');
                const icon = isImage ? '&#128247;' : isPdf ? '&#128196;' : '&#128206;';
                const users = API.getUsers();
                const uploader = users.find(u => u.id === a.uploaded_by);
                const uploaderName = uploader ? uploader.name : '';
                const date = a.uploaded_at ? new Date(a.uploaded_at).toLocaleDateString() : '';
                return `<tr data-att-id="${a.id}">
                    <td>${icon} ${esc(a.filename)}</td>
                    <td style="font-size:11px;">${esc(a.file_type || 'unknown')}</td>
                    <td>${esc(uploaderName)}</td>
                    <td>${date}</td>
                    <td>
                        <button class="btn btn-sm btn-att-view" data-att-id="${a.id}">View</button>
                        <button class="btn btn-sm btn-att-download" data-att-id="${a.id}">Download</button>
                        ${hasLock ? `<button class="btn btn-sm btn-danger btn-att-delete" data-att-id="${a.id}">Delete</button>` : ''}
                    </td>
                </tr>`;
            }).join('')}</tbody>
        </table>`;

        // View
        list.querySelectorAll('.btn-att-view').forEach(btn => {
            btn.addEventListener('click', () => {
                const att = attachments.find(a => a.id === parseFloat(btn.dataset.attId));
                if (!att || !att.dataUrl) return;
                viewAttachment(att);
            });
        });

        // Download
        list.querySelectorAll('.btn-att-download').forEach(btn => {
            btn.addEventListener('click', () => {
                const att = attachments.find(a => a.id === parseFloat(btn.dataset.attId));
                if (!att || !att.dataUrl) return;
                const link = document.createElement('a');
                link.href = att.dataUrl;
                link.download = att.filename;
                link.click();
            });
        });

        // Delete
        list.querySelectorAll('.btn-att-delete').forEach(btn => {
            btn.addEventListener('click', () => {
                if (!confirm('Delete this attachment?')) return;
                API.deleteAttachment(currentReport.id, parseFloat(btn.dataset.attId));
                currentReport = API.getReport(currentReport.id);
                renderAttachments();
                toast('Attachment deleted', 'info');
            });
        });
    }

    function viewAttachment(att) {
        const isImage = att.file_type && att.file_type.startsWith('image/');
        const isPdf = att.file_type && att.file_type.includes('pdf');

        // Create modal overlay
        let modal = $('#att-viewer-modal');
        if (!modal) {
            modal = document.createElement('div');
            modal.id = 'att-viewer-modal';
            modal.className = 'modal';
            modal.innerHTML = '<div class="modal-content modal-wide" style="max-width:900px;max-height:90vh;overflow:auto;"><div class="admin-header"><h2 id="att-viewer-title"></h2><button id="btn-close-att-viewer" class="btn btn-sm btn-outline">Close</button></div><div id="att-viewer-body" style="text-align:center;"></div></div>';
            document.body.appendChild(modal);
            modal.querySelector('#btn-close-att-viewer').addEventListener('click', () => modal.classList.add('hidden'));
            modal.addEventListener('click', (e) => { if (e.target === modal) modal.classList.add('hidden'); });
        }

        modal.querySelector('#att-viewer-title').textContent = att.filename;
        const body = modal.querySelector('#att-viewer-body');

        if (isImage) {
            body.innerHTML = `<img src="${att.dataUrl}" style="max-width:100%;max-height:70vh;border-radius:4px;">`;
        } else if (isPdf) {
            body.innerHTML = `<iframe src="${att.dataUrl}" style="width:100%;height:70vh;border:1px solid #ccc;border-radius:4px;"></iframe>`;
        } else {
            body.innerHTML = `<p style="padding:40px;color:#888;">Preview not available for this file type.<br>Use the Download button instead.</p>`;
        }

        modal.classList.remove('hidden');
    }

    // ─── Lock UI ──────────────────────────────────────────────────────────
    function updateLockUI() {
        const lockStatus = $('#lock-status');
        const btnLock = $('#btn-lock'), btnUnlock = $('#btn-unlock'), btnPdf = $('#btn-pdf');
        const saveBar = $('#save-bar');
        const btnSubmit = $('#btn-submit-review');
        const btnApprove = $('#btn-approve-report');
        const btnReject = $('#btn-reject-report');
        const btnFinal = $('#btn-final-save');

        if (!currentReport) {
            lockStatus.textContent = ''; lockStatus.className = 'lock-status';
            btnLock.classList.add('hidden'); btnUnlock.classList.add('hidden');
            btnPdf.classList.add('hidden'); if (saveBar) saveBar.classList.add('hidden');
            return;
        }

        btnPdf.classList.remove('hidden');
        const report = API.getReport(currentReport.id);
        if (report) currentReport = report;
        const isLocked = !!currentReport.lock;
        const hasLock = Auth.hasLock(currentReport);
        const user = Auth.getUser();
        const isLeadOrAdmin = user && (user.role === 'Lead Inspector' || user.is_admin);
        const status = currentReport.status || 'draft';

        if (isLocked && hasLock) {
            lockStatus.textContent = 'You are editing'; lockStatus.className = 'lock-status you-editing';
            btnLock.classList.add('hidden'); btnUnlock.classList.remove('hidden');
            btnUnlock.textContent = 'Release Lock';
            if (saveBar) saveBar.classList.remove('hidden');

            // Workflow buttons by status + role:
            // Draft: "Save Draft" + "Submit for Review"
            // In Review + Lead/Admin: "Approve & Finalize" + "Reject"
            // In Review + Inspector: "Save Draft" only (read the review)
            btnSubmit.style.display = (status === 'draft') ? '' : 'none';
            btnApprove.style.display = (status === 'in_review' && isLeadOrAdmin) ? '' : 'none';
            btnReject.style.display = (status === 'in_review' && isLeadOrAdmin) ? '' : 'none';
            btnFinal.style.display = 'none'; // hidden — Approve now does final save
        } else if (isLocked) {
            lockStatus.textContent = `Locked by ${currentReport.lock.user_name || '?'}`; lockStatus.className = 'lock-status locked';
            btnLock.classList.add('hidden');
            // Admin can force-unlock other users' locks
            btnUnlock.classList.toggle('hidden', !isLeadOrAdmin);
            if (isLeadOrAdmin) btnUnlock.textContent = 'Force Unlock';
            if (saveBar) saveBar.classList.add('hidden');
        } else {
            // Show status in lock area
            const statusLabels = { draft: 'Draft - Available', in_review: 'Pending Review', approved: 'Approved', final: 'Finalized' };
            lockStatus.textContent = statusLabels[status] || 'Available';
            lockStatus.className = 'lock-status ' + (status === 'final' ? 'locked' : 'unlocked');
            btnLock.classList.toggle('hidden', status === 'final');
            btnUnlock.classList.add('hidden');
            if (saveBar) saveBar.classList.add('hidden');
        }

        // Update review badge
        if (typeof Library !== 'undefined') Library.updateReviewBadge();
    }

    // ─── Save All ─────────────────────────────────────────────────────────
    function saveAll() {
        const user = Auth.getUser();
        if (!user || !currentReport || !Auth.hasLock(currentReport)) {
            toast('You need the edit lock to save.', 'error'); return;
        }
        try {
            // Create version snapshot BEFORE saving new data
            API.createVersion(currentReport.id, user.id);

            // Header
            const headerData = {};
            $$('.inline-input[data-skey="header"]').forEach(inp => headerData[inp.dataset.fkey] = inp.value);
            if (Object.keys(headerData).length) API.saveSection(currentReport.id, 'header', headerData, user.id);

            // Quill narratives
            quillEditors.forEach((quill, sectionKey) => {
                API.saveSection(currentReport.id, sectionKey, { content: quill.root.innerHTML }, user.id);
            });

            // 510 EXT: Inspector info + Checklist
            const config = API.getReportTypeConfig(currentReport.report_type || 'tower');
            if (config.checklistCategories) {
                // Inspector info
                const inspData = {};
                $$('.inline-input[data-skey="ext510_inspector"]').forEach(inp => inspData[inp.dataset.fkey] = inp.value);
                if (Object.keys(inspData).length) API.saveSection(currentReport.id, 'ext510_inspector', inspData, user.id);
                // Checklist
                API.saveSection(currentReport.id, 'checklist', collectChecklistData(), user.id);
            }

            // Inspection type
            const intCheck = $('[data-field="internal_inspection"]');
            const extCheck = $('[data-field="external_inspection_check"]');
            const inspectors = [];
            $$('#inspectors-edit-list .inspector-edit-row').forEach(row => {
                const insp = {};
                row.querySelectorAll('[data-insp]').forEach(inp => insp[inp.dataset.insp] = inp.value);
                if (insp.name) inspectors.push(insp);
            });
            API.saveSection(currentReport.id, 'inspection_type', {
                internal_inspection: intCheck ? intCheck.classList.contains('checked') : false,
                external_inspection_check: extCheck ? extCheck.classList.contains('checked') : false,
                inspectors,
            }, user.id);

            dirty = false;
            const s = $('#save-status'); if (s) { s.textContent = 'Saved!'; setTimeout(() => s.textContent = '', 2000); }
            currentReport = API.getReport(currentReport.id);
            toast('Report saved!', 'success');
        } catch (err) { toast('Save failed: ' + err.message, 'error'); }
    }

    function getSectionData(key) {
        if (!currentReport || !currentReport.sections || !currentReport.sections[key]) return {};
        return currentReport.sections[key].section_data || {};
    }

    function bindRemoveInspector(container) {
        container.querySelectorAll('.btn-remove-inspector').forEach(btn => {
            btn.onclick = () => { btn.closest('.inspector-edit-row').remove(); markDirty(); };
        });
    }

    // ─── Events ───────────────────────────────────────────────────────────
    function bindEvents() {
        $('#login-form').addEventListener('submit', (e) => {
            e.preventDefault();
            const name = $('#login-name').value.trim(); if (!name) return;
            const user = Auth.login(name, $('#login-role').value, $('#login-cert').value.trim());
            showApp(user); toast(`Welcome, ${user.name}!`, 'success');
        });

        $('#btn-logout').addEventListener('click', () => {
            if (currentReport && Auth.hasLock(currentReport)) {
                if (dirty) saveAll();
                try { Auth.releaseLock(currentReport.id); } catch(e) {}
            }
            destroyQuills(); Auth.logout(); currentReport = null;
            clearInterval(lockRefreshInterval); showLogin();
        });

        $('#report-selector').addEventListener('change', (e) => loadReport(e.target.value));
        $('#site-selector').addEventListener('change', () => { loadReportList(); });
        $('#btn-new-report').addEventListener('click', () => {
            // Populate site selector with user's accessible sites
            const user = Auth.getUser();
            const userSites = user ? API.getUserSites(user.id) : [];
            const siteSelect = $('#nr-site');
            siteSelect.innerHTML = '<option value="">-- Select Site --</option>';
            userSites.forEach(s => {
                const opt = document.createElement('option');
                opt.value = s.id;
                opt.textContent = s.client_name ? `${s.client_name} - ${s.plant_name}` : s.plant_name;
                siteSelect.appendChild(opt);
            });
            // Auto-select site: toolbar selection > single site > first site
            const toolbarSite = getSelectedSiteId();
            if (toolbarSite) {
                siteSelect.value = toolbarSite;
            } else if (userSites.length === 1) {
                siteSelect.value = userSites[0].id;
            } else if (userSites.length > 1) {
                siteSelect.value = userSites[0].id;
            }
            updateNewReportTypes();
            $('#nr-equip-select').value = '';
            $('#nr-add-new-fields').classList.add('hidden');
            $('#new-report-modal').classList.remove('hidden');
        });

        // Update report types based on selected site in New Report modal
        function updateNewReportTypes() {
            const siteVal = $('#nr-site').value;
            const siteId = siteVal ? parseSiteId(siteVal) : null;
            const typeSelect = $('#nr-type');
            const allTypes = [
                { key: 'tower', label: 'Tower / Column' }, { key: 'exchanger', label: 'Exchanger' },
                { key: 'aircooler', label: 'Air Cooler (Finfan)' }, { key: 'drum', label: 'Drum' },
                { key: 'heater', label: 'Heater / Boiler' }, { key: 'ext510', label: '510 External Inspection' }, { key: 'ext570', label: '570 External Inspection' },
            ];
            let enabledTypes = allTypes;
            if (siteId) {
                const site = API.getSites().find(s => s.id === siteId);
                if (site && site.enabled_types && site.enabled_types.length > 0) {
                    enabledTypes = allTypes.filter(t => site.enabled_types.includes(t.key));
                }
            }
            typeSelect.innerHTML = enabledTypes.map(t => `<option value="${t.key}">${t.label}</option>`).join('');
            populateEquipDropdown();
        }
        $('#nr-site').addEventListener('change', () => updateNewReportTypes());
        $('#btn-cancel-new').addEventListener('click', () => $('#new-report-modal').classList.add('hidden'));

        $('#new-report-form').addEventListener('submit', (e) => {
            e.preventDefault();
            const user = Auth.getUser();
            const nrSiteVal = $('#nr-site').value;
            if (!nrSiteVal) { toast('Please select a site.', 'error'); return; }
            const siteId = parseSiteId(nrSiteVal);
            const reportType = $('#nr-type').value;
            const equipVal = $('#nr-equip-select').value;

            let headerOverrides = {};
            let unitNum = '', equipNumber = '', serialNum = '';

            if (equipVal === '__new__') {
                // Add new equipment
                equipNumber = $('#nr-equipment').value.trim();
                unitNum = $('#nr-unit').value.trim();
                if (!equipNumber) { toast('Equipment # is required.', 'error'); return; }
            } else if (equipVal) {
                // From imported data
                const equip = API.getEquipmentById(equipVal, reportType);
                if (equip) {
                    headerOverrides = { ...equip };
                    delete headerOverrides.id;
                    delete headerOverrides.created_at;
                    delete headerOverrides.updated_at;
                    delete headerOverrides.report_type;
                    delete headerOverrides.site_id;
                    unitNum = equip.unit_number || '';
                    equipNumber = equip.equipment_number || '';
                    serialNum = equip.nb_serial_number || '';
                }
            } else {
                toast('Please select equipment.', 'error'); return;
            }

            const report = API.createReport({
                unit_number: unitNum,
                equipment_number: equipNumber,
                nb_serial_number: serialNum,
                project_name: '',
                created_by: user.id, report_type: reportType, site_id: siteId,
            });

            // Auto-fill header section with all equipment master data
            if (Object.keys(headerOverrides).length) {
                try {
                    API.acquireLock(report.id, user.id);
                    const existing = report.sections?.header?.section_data || {};
                    API.saveSection(report.id, 'header', { ...existing, ...headerOverrides }, user.id);
                    API.releaseLock(report.id, user.id);
                } catch(e) {}
            }

            $('#new-report-modal').classList.add('hidden'); $('#new-report-form').reset();
            $('#nr-add-new-fields').classList.add('hidden');
            loadReportList(); $('#report-selector').value = report.id; loadReport(report.id);
            toast('Report created!' + (equipVal !== '__new__' ? ' Header auto-filled from master data.' : ''), 'success');
        });

        // Lock/Unlock
        $('#btn-lock').addEventListener('click', () => {
            if (!currentReport) return;
            try {
                Auth.acquireLock(currentReport.id);
                currentReport = API.getReport(currentReport.id);
                loadReport(currentReport.id);
                toast('Edit lock acquired.', 'success');
                clearInterval(lockRefreshInterval);
                lockRefreshInterval = setInterval(() => {
                    if (currentReport && Auth.hasLock(currentReport)) try { Auth.acquireLock(currentReport.id); } catch(e) {}
                }, 5 * 60 * 1000);
            } catch (err) { toast(err.message, 'error'); }
        });

        $('#btn-unlock').addEventListener('click', () => {
            if (!currentReport) return;
            const hasLock = Auth.hasLock(currentReport);
            const isAdmin = Auth.isAdmin();

            if (hasLock) {
                // Own lock — save and release
                if (dirty) saveAll();
                try {
                    destroyQuills(); Auth.releaseLock(currentReport.id);
                    clearInterval(lockRefreshInterval);
                    currentReport = API.getReport(currentReport.id);
                    loadReport(currentReport.id, { skipAutoLock: true }); toast('Lock released.', 'info');
                } catch (err) { toast(err.message, 'error'); }
            } else if (isAdmin && currentReport.lock) {
                // Admin force unlock another user's lock
                if (!confirm(`Force release lock held by ${currentReport.lock.user_name}?`)) return;
                API.forceUnlock(currentReport.id);
                currentReport = API.getReport(currentReport.id);
                loadReport(currentReport.id, { skipAutoLock: true }); toast('Lock force-released.', 'info');
            }
        });

        $('#btn-save-all').addEventListener('click', () => saveAll());

        // Submit for Review
        $('#btn-submit-review').addEventListener('click', () => {
            if (!currentReport || !Auth.hasLock(currentReport)) return;
            if (!confirm('Submit this report for Lead Inspector review?')) return;
            saveAll();
            const user = Auth.getUser();
            try {
                API.updateReportStatus(currentReport.id, 'in_review', user.id);
                try { Auth.releaseLock(currentReport.id); } catch(e) {}
                clearInterval(lockRefreshInterval);
                currentReport = API.getReport(currentReport.id);
                loadReportList();
                loadReport(currentReport.id);
                toast('Report submitted for review!', 'success');
            } catch (err) { toast(err.message, 'error'); }
        });

        // Approve, Finalize & Generate PDF (Lead Inspector — single action)
        $('#btn-approve-report').addEventListener('click', async () => {
            if (!currentReport || !Auth.hasLock(currentReport)) return;
            if (!confirm('Approve and finalize this report? This will generate a PDF and save to the Final Reports library.')) return;

            saveAll();
            const user = Auth.getUser();
            try {
                API.finalizeReport(currentReport.id, user.id, null);
                currentReport = API.getReport(currentReport.id);
                toast('Report approved & finalized! Generating PDF...', 'success');

                try { Auth.releaseLock(currentReport.id); } catch(e) {}
                clearInterval(lockRefreshInterval);

                await PDF.generate(currentReport, { autoDownload: true });

                loadReportList();
                loadReport(currentReport.id);
                toast('Final report saved to library!', 'success');
            } catch (err) { toast('Finalize failed: ' + err.message, 'error'); }
        });

        // Reject Report (Back to Draft)
        $('#btn-reject-report').addEventListener('click', () => {
            if (!currentReport || !Auth.hasLock(currentReport)) return;
            const reason = prompt('Enter rejection reason:');
            if (reason === null) return;
            if (!reason.trim()) { toast('Please provide a rejection reason.', 'error'); return; }
            saveAll();
            const user = Auth.getUser();
            try {
                API.updateReportStatus(currentReport.id, 'draft', user.id, { rejection_reason: reason.trim() });
                try { Auth.releaseLock(currentReport.id); } catch(e) {}
                clearInterval(lockRefreshInterval);
                currentReport = API.getReport(currentReport.id);
                loadReportList();
                loadReport(currentReport.id);
                toast('Report rejected and returned to draft.', 'info');
            } catch (err) { toast(err.message, 'error'); }
        });

        // Final Save (legacy — kept for direct finalize if needed)
        $('#btn-final-save').addEventListener('click', async () => {
            if (!currentReport || !Auth.hasLock(currentReport)) {
                toast('You need the edit lock.', 'error'); return;
            }
            if (!confirm('Finalize this report and generate PDF?')) return;

            saveAll();
            const user = Auth.getUser();
            try {
                API.finalizeReport(currentReport.id, user.id, null);
                currentReport = API.getReport(currentReport.id);
                toast('Report finalized! Generating PDF...', 'success');

                try { Auth.releaseLock(currentReport.id); } catch(e) {}
                clearInterval(lockRefreshInterval);

                await PDF.generate(currentReport, { autoDownload: true });

                loadReportList();
                loadReport(currentReport.id);
                toast('Final report saved to library!', 'success');
            } catch (err) { toast('Finalize failed: ' + err.message, 'error'); }
        });

        // ─── Field mapping for import ────────────────────────────────────
        const FIELD_MAP = {
            'unit': 'unit_number', 'unit_#': 'unit_number', 'unit_number': 'unit_number', 'unit_no': 'unit_number',
            'equipment': 'equipment_number', 'equipment_#': 'equipment_number', 'equipment_number': 'equipment_number',
            'nb_serial': 'nb_serial_number', 'serial': 'nb_serial_number', 'serial_number': 'nb_serial_number',
            'project': 'project_name', 'turnaround': 'project_name', 'project_name': 'project_name',
            'equipment_name': 'equipment_name', 'name': 'equipment_name',
            'equipment_type': 'equipment_type', 'type': 'equipment_type',
            'report_type': 'report_type',
            'shell_material': 'shell_material', 'shell_thickness': 'shell_thickness',
            'height': 'height', 'internal_diameter': 'internal_diameter',
            'head_material': 'head_material', 'head_thickness': 'head_thickness',
            'cladding_material': 'cladding_material', 'cladding_lining_material': 'cladding_material',
            'nde_performed': 'nde_performed', 'stress_relieved': 'stress_relieved',
            'corrosion_allowance': 'corrosion_allowance', 'acceptance_criteria': 'acceptance_criteria',
            'tube_material': 'tube_material', 'tube_thickness': 'tube_thickness',
            'ect_performed': 'ect_performed', 'test_pressure': 'test_pressure',
            'header_box_material': 'header_box_material', 'header_box_thickness': 'header_box_thickness',
            'tube_sheet_material': 'tube_sheet_material', 'tube_sheet_thickness': 'tube_sheet_thickness',
            'total_tubes': 'total_tubes', 'mfr_number': 'mfr_number',
        };
        function mapRow(row) {
            const m = {};
            for (const [k, v] of Object.entries(row)) {
                const norm = k.toLowerCase().replace(/[^a-z0-9]/g, '_');
                m[FIELD_MAP[norm] || norm] = String(v);
            }
            return m;
        }

        function renderEquipMasterList() {
            let all = API.getAllEquipment();
            const container = $('#equip-master-list');
            const countEl = $('#equip-count');
            const sites = API.getSites();
            const typeLabels = { tower:'Tower', exchanger:'Exchanger', aircooler:'Air Cooler', drum:'Drum', heater:'Heater', ext510:'510 EXT', ext570:'570 EXT' };

            // Apply filters
            const filterType = $('#equip-filter-type') ? $('#equip-filter-type').value : '';
            const filterSite = $('#equip-filter-site') ? $('#equip-filter-site').value : '';
            const filterSearch = $('#equip-filter-search') ? $('#equip-filter-search').value.toLowerCase() : '';

            if (filterType) all = all.filter(e => e.report_type === filterType);
            if (filterSite) all = all.filter(e => e.site_id === parseSiteId(filterSite));
            if (filterSearch) all = all.filter(e =>
                (e.equipment_number || '').toLowerCase().includes(filterSearch) ||
                (e.equipment_name || '').toLowerCase().includes(filterSearch) ||
                (e.unit_number || '').toLowerCase().includes(filterSearch)
            );

            if (countEl) countEl.textContent = `(${all.length} items)`;
            if (all.length === 0) { container.innerHTML = '<p style="color:#aaa;text-align:center;">No equipment found.</p>'; return; }

            container.innerHTML = `<table class="admin-table" style="font-size:12px;">
                <thead><tr><th>Equipment #</th><th>Name</th><th>Type</th><th>Unit</th><th>Site</th><th></th></tr></thead>
                <tbody>${all.map(e => {
                    const site = sites.find(s => s.id === e.site_id);
                    const siteName = site ? site.plant_name : '';
                    return `<tr>
                    <td><strong>${esc(e.equipment_number || '')}</strong></td>
                    <td>${esc(e.equipment_name || '')}</td>
                    <td><span class="status-badge draft">${typeLabels[e.report_type] || e.report_type || ''}</span></td>
                    <td>${esc(e.unit_number || '')}</td>
                    <td style="font-size:11px;">${esc(siteName)}</td>
                    <td><button class="btn btn-sm btn-danger" onclick="API.deleteEquipment(${e.id});renderEquipMasterList();">Del</button></td>
                </tr>`;
                }).join('')}</tbody>
            </table>`;
        }
        // Expose for inline onclick
        window.renderEquipMasterList = renderEquipMasterList;

        // Export CSV template with header columns for selected report type
        $('#btn-export-equip').addEventListener('click', () => {
            const filterType = ($('#equip-filter-type') ? $('#equip-filter-type').value : '') ||
                               ($('#import-type') ? $('#import-type').value : '');
            const type = filterType || 'tower';
            const config = API.getReportTypeConfig(type);

            // Build columns: report_type and site_id first, then header fields
            const cols = ['report_type', 'site_id', 'unit_number', 'equipment_number', 'nb_serial_number', 'project_name'];
            (config.headerFields || []).forEach(row => {
                if (row[1] && !cols.includes(row[1])) cols.push(row[1]);
                if (row[3] && !cols.includes(row[3])) cols.push(row[3]);
            });

            // Default values for report_type and site_id
            const defaultType = type;
            const filterSite = $('#equip-filter-site') ? $('#equip-filter-site').value : '';
            const defaultSiteId = filterSite || '';

            // Get existing data matching filter
            let all = API.getAllEquipment();
            const filterSearch = $('#equip-filter-search') ? $('#equip-filter-search').value.toLowerCase() : '';
            if (filterType) all = all.filter(e => e.report_type === filterType);
            if (filterSite) all = all.filter(e => e.site_id === parseSiteId(filterSite));
            if (filterSearch) all = all.filter(e =>
                (e.equipment_number || '').toLowerCase().includes(filterSearch) ||
                (e.equipment_name || '').toLowerCase().includes(filterSearch) ||
                (e.unit_number || '').toLowerCase().includes(filterSearch)
            );

            // Defaults from config
            const defaults = config.headerDefaults || {};

            // Build CSV with defaults pre-filled
            const escCsv = v => { const s = String(v || ''); return s.includes(',') || s.includes('"') || s.includes('\n') ? '"' + s.replace(/"/g, '""') + '"' : s; };
            let csv = cols.map(escCsv).join(',') + '\n';
            if (all.length > 0) {
                all.forEach(e => {
                    csv += cols.map(c => {
                        if (c === 'report_type') return escCsv(e[c] || defaultType);
                        if (c === 'site_id') return escCsv(e[c] || defaultSiteId);
                        return escCsv(e[c] || '');
                    }).join(',') + '\n';
                });
            } else {
                // Empty template row with report_type, site_id, and headerDefaults pre-filled
                csv += cols.map(c => {
                    if (c === 'report_type') return escCsv(defaultType);
                    if (c === 'site_id') return escCsv(defaultSiteId);
                    if (defaults[c]) return escCsv(defaults[c]);
                    return '';
                }).join(',') + '\n';
            }

            // Download
            const blob = new Blob([csv], { type: 'text/csv' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            const typeNames = { tower:'Tower', exchanger:'Exchanger', aircooler:'Air_Cooler', drum:'Drum', heater:'Heater', ext510:'510_EXT', ext570:'570_EXT' };
            a.download = `Equipment_Master_${typeNames[type] || type}_${new Date().toISOString().slice(0,10)}.csv`;
            a.click();
            URL.revokeObjectURL(url);
            toast(`Exported ${all.length} records with ${cols.length} columns for ${config.title}.`, 'success');
        });

        function populateSiteDropdowns() {
            const sites = API.getSites();
            ['#import-site', '#equip-filter-site'].forEach(sel => {
                const el = $(sel);
                if (!el) return;
                const val = el.value;
                const firstOpt = el.options[0].textContent;
                el.innerHTML = `<option value="">${firstOpt}</option>`;
                sites.forEach(s => {
                    const opt = document.createElement('option');
                    opt.value = s.id;
                    opt.textContent = `${s.client_name} - ${s.plant_name}`;
                    el.appendChild(opt);
                });
                if (val) el.value = val;
            });
        }

        // Portal Import — open modal
        $('#btn-import-portal').addEventListener('click', () => {
            $('#import-modal').classList.remove('hidden');
            $('#import-preview').innerHTML = '';
            $('#import-result').innerHTML = '';
            populateSiteDropdowns();
            renderEquipMasterList();
        });
        $('#btn-close-import').addEventListener('click', () => $('#import-modal').classList.add('hidden'));

        // Parse uploaded file
        $('#import-portal-file').addEventListener('change', (e) => {
            const file = e.target.files[0]; if (!file) return;
            const ext = file.name.split('.').pop().toLowerCase();
            const reader = new FileReader();
            reader.onload = (ev) => {
                try {
                    let rows = [];
                    if (ext === 'json') {
                        const json = JSON.parse(ev.target.result);
                        rows = Array.isArray(json) ? json : [json];
                    } else if (ext === 'csv') {
                        const lines = ev.target.result.trim().split('\n');
                        if (lines.length >= 2) {
                            const headers = lines[0].split(',').map(h => h.trim());
                            for (let i = 1; i < lines.length; i++) {
                                const vals = lines[i].split(',').map(v => v.trim().replace(/^["']|["']$/g, ''));
                                const obj = {};
                                headers.forEach((h, j) => { if (vals[j]) obj[h] = vals[j]; });
                                if (Object.keys(obj).length) rows.push(obj);
                            }
                        }
                    }
                    window._importRows = rows;
                    if (!rows.length) { $('#import-preview').innerHTML = '<p style="color:#e74c3c;">No data found.</p>'; return; }
                    const keys = Object.keys(rows[0]);
                    $('#import-preview').innerHTML = `<table class="admin-table" style="font-size:12px;">
                        <thead><tr>${keys.map(k => `<th>${esc(k)}</th>`).join('')}</tr></thead>
                        <tbody>${rows.map(r => `<tr>${keys.map(k => `<td>${esc(r[k] || '')}</td>`).join('')}</tr>`).join('')}</tbody>
                    </table><p style="font-size:12px;color:#888;margin-top:6px;">${rows.length} row(s). Click "Import to Master List".</p>`;
                } catch (err) { $('#import-preview').innerHTML = `<p style="color:#e74c3c;">${err.message}</p>`; }
            };
            reader.readAsText(file);
        });

        // Import to equipment master
        $('#btn-run-import').addEventListener('click', () => {
            const rows = window._importRows;
            if (!rows || !rows.length) { toast('Upload a file first.', 'error'); return; }
            const defaultType = $('#import-type').value;
            const defaultSiteId = $('#import-site').value ? parseSiteId($('#import-site').value) : null;

            const mapped = rows.map(r => {
                const m = mapRow(r);
                // Apply defaults from dropdowns if not in file
                if (!m.report_type && defaultType) m.report_type = defaultType;
                if (!m.report_type) m.report_type = 'tower';
                if (!m.site_id && defaultSiteId) m.site_id = defaultSiteId;
                if (m.site_id) m.site_id = parseSiteId(m.site_id);
                if (!m.equipment_number) { toast('Each row needs equipment_number.', 'error'); return null; }
                return m;
            }).filter(Boolean);
            if (!mapped.length) return;
            const result = API.importEquipment(mapped);
            renderEquipMasterList();
            const msg = `Imported: ${result.added} new, ${result.updated} updated.`;
            $('#import-result').innerHTML = `<p style="color:#27ae60;font-weight:600;">${msg}</p>`;
            toast(msg, 'success');
            window._importRows = null;
            $('#import-portal-file').value = '';
        });

        // Master list filter events
        ['#equip-filter-type', '#equip-filter-site'].forEach(sel => {
            const el = $(sel);
            if (el) el.addEventListener('change', renderEquipMasterList);
        });
        const searchEl = $('#equip-filter-search');
        if (searchEl) searchEl.addEventListener('input', renderEquipMasterList);

        // ─── New Report: equipment dropdown auto-fill ─────────────────────
        // When report type changes, populate equipment dropdown
        $('#nr-type').addEventListener('change', () => populateEquipDropdown());
        function populateEquipDropdown() {
            const type = $('#nr-type').value;
            // Use modal site selector if open, otherwise toolbar
            const nrSiteVal = $('#nr-site') ? $('#nr-site').value : '';
            const siteId = nrSiteVal ? parseSiteId(nrSiteVal) : getSelectedSiteId();
            const equipment = API.getEquipment(type, siteId);
            const select = $('#nr-equip-select');
            select.innerHTML = '<option value="">-- Select Equipment --</option>';
            equipment.forEach(e => {
                const opt = document.createElement('option');
                opt.value = e.equipment_number;
                opt.textContent = `${e.equipment_number} - ${e.equipment_name || ''}`;
                select.appendChild(opt);
            });
            select.innerHTML += '<option value="__new__">+ Add New Equipment</option>';
        }

        // When equipment selected, show/hide add-new fields
        $('#nr-equip-select').addEventListener('change', () => {
            const val = $('#nr-equip-select').value;
            const addNewFields = $('#nr-add-new-fields');
            if (val === '__new__') {
                addNewFields.classList.remove('hidden');
                $('#nr-equipment').required = true;
            } else {
                addNewFields.classList.add('hidden');
                $('#nr-equipment').required = false;
            }
        });

        document.addEventListener('input', (e) => {
            if (e.target.classList.contains('inline-input')) markDirty();
        });

        // Inspector add
        $('#btn-add-inspector').addEventListener('click', () => {
            const list = $('#inspectors-edit-list');
            list.insertAdjacentHTML('beforeend', `<div class="inspector-edit-row">
                <input type="text" data-insp="name" placeholder="Inspector Name">
                <input type="text" data-insp="api_cert" placeholder="API Cert #">
                <input type="date" data-insp="date">
                <button type="button" class="btn btn-sm btn-danger btn-remove-inspector">&times;</button>
            </div>`);
            bindRemoveInspector(list); markDirty();
        });

        // Orientation photos
        $('#orient-file').addEventListener('change', async (e) => {
            const file = e.target.files[0]; if (!file || !currentReport) return;
            const user = Auth.getUser();
            const compressed = await compressImage(file, 800, 600, 0.7);
            const data = getSectionData('orientation_photos');
            data.orientation_photo = compressed;
            try { API.saveSection(currentReport.id, 'orientation_photos', data, user.id); currentReport = API.getReport(currentReport.id); renderOrientPhotos(); toast('Orientation photo saved!', 'success'); } catch (err) { toast(err.message, 'error'); }
            e.target.value = '';
        });
        $('#dataplate-file').addEventListener('change', async (e) => {
            const file = e.target.files[0]; if (!file || !currentReport) return;
            const user = Auth.getUser();
            const compressed = await compressImage(file, 800, 600, 0.7);
            const data = getSectionData('orientation_photos');
            data.dataplate_photo = compressed;
            try { API.saveSection(currentReport.id, 'orientation_photos', data, user.id); currentReport = API.getReport(currentReport.id); renderOrientPhotos(); toast('Data Plate photo saved!', 'success'); } catch (err) { toast(err.message, 'error'); }
            e.target.value = '';
        });

        // Photo upload
        $('#btn-choose-photos').addEventListener('click', () => $('#photo-upload').click());
        $('#photo-upload').addEventListener('change', async () => {
            const files = $('#photo-upload').files; const user = Auth.getUser();
            if (!files.length || !user || !currentReport) return;
            for (const file of Array.from(files)) {
                const compressed = await compressImage(file, 800, 600, 0.7);
                API.addPhoto(currentReport.id, { filename: file.name, dataUrl: compressed, caption: '', uploaded_by: user.id });
            }
            currentReport = API.getReport(currentReport.id); renderPhotos();
            $('#photo-upload').value = ''; toast(`${files.length} photo(s) added!`, 'success');
        });


        // PDF
        $('#btn-pdf').addEventListener('click', () => {
            if (!currentReport) return;
            if (dirty) saveAll();
            PDF.generate(currentReport);
        });

        // Admin
        $('#btn-admin').addEventListener('click', () => Admin.open());

        // Library
        $('#btn-library').addEventListener('click', () => Library.show());

        // Version banner — back to current
        $('#btn-back-current').addEventListener('click', () => {
            viewingVersion = null;
            $('#version-banner').classList.add('hidden');
            loadReport(currentReport.id);
        });

        window.addEventListener('beforeunload', (e) => { if (dirty) { e.preventDefault(); e.returnValue = ''; } });
    }

    return { init, toast, viewVersion, loadSiteSelector };
})();

document.addEventListener('DOMContentLoaded', App.init);
