// ─── Library Dashboard & Version History ──────────────────────────────────

const Library = (() => {
    let activeTab = 'progress';
    // Track downloaded final report IDs in localStorage
    const DOWNLOADED_KEY = 'finalReportsDownloaded';
    function getDownloaded() {
        try { return JSON.parse(localStorage.getItem(DOWNLOADED_KEY) || '[]'); } catch { return []; }
    }
    function markDownloaded(id) {
        const dl = getDownloaded();
        if (!dl.includes(id)) { dl.push(id); localStorage.setItem(DOWNLOADED_KEY, JSON.stringify(dl)); }
    }

    function show() {
        document.getElementById('report-container').classList.add('hidden');
        document.getElementById('library-container').classList.remove('hidden');

        // Only show Review Queue tab for Lead Inspector / Admin
        const user = Auth.getUser();
        const canReview = user && (user.role === 'Lead Inspector' || user.is_admin);
        const reviewTab = document.querySelector('.lib-tab[data-libtab="review"]');
        if (reviewTab) reviewTab.style.display = canReview ? '' : 'none';
        if (!canReview && activeTab === 'review') activeTab = 'progress';

        switchTab(activeTab);
    }

    function hide() { document.getElementById('library-container').classList.add('hidden'); invalidateReportsCache(); }

    function switchTab(tab) {
        activeTab = tab;
        document.querySelectorAll('.lib-tab').forEach(t => t.classList.toggle('active', t.dataset.libtab === tab));
        document.getElementById('lib-tab-progress').classList.toggle('hidden', tab !== 'progress');
        document.getElementById('lib-tab-review').classList.toggle('hidden', tab !== 'review');
        document.getElementById('lib-tab-final').classList.toggle('hidden', tab !== 'final');
        if (tab === 'progress') renderProgress().catch(console.error);
        else if (tab === 'review') renderReview().catch(console.error);
        else renderFinal().catch(console.error);
    }

    // Cache the reports list briefly so tab switches / multiple renders don't re-fetch
    let _cachedReports = null;
    let _cacheTime = 0;
    const CACHE_MS = 2000;
    async function getReportsCached() {
        const now = Date.now();
        if (_cachedReports && (now - _cacheTime) < CACHE_MS) return _cachedReports;
        _cachedReports = await API.getReports();
        _cacheTime = now;
        return _cachedReports;
    }
    function invalidateReportsCache() { _cachedReports = null; _cacheTime = 0; }

    async function updateReviewBadge(reports) {
        if (!reports) reports = await getReportsCached();
        const count = reports.filter(r => r.status === 'in_review').length;
        const badge = document.getElementById('review-count');
        if (badge) badge.textContent = count > 0 ? count : '';
    }

    // ─── Progress Reports ─────────────────────────────────────────────────
    async function renderProgress(filterStatus, searchText) {
        const tbody = document.getElementById('lib-tbody');
        // Fetch users and reports in parallel
        const [users, allReports] = await Promise.all([API.getUsers(), getReportsCached()]);
        updateReviewBadge(allReports);
        let reports = allReports.filter(r => r.status !== 'final' && r.status !== 'in_review');
        // Filter by selected site
        const siteId = document.getElementById('site-selector') ? parseInt(document.getElementById('site-selector').value) : null;
        if (siteId) reports = reports.filter(r => r.site_id === siteId);

        if (filterStatus) reports = reports.filter(r => r.status === filterStatus);
        if (searchText) {
            const s = searchText.toLowerCase();
            reports = reports.filter(r => (r.equipment_number || '').toLowerCase().includes(s) || (r.project_name || '').toLowerCase().includes(s));
        }

        const isAdmin = Auth.isAdmin();
        tbody.innerHTML = reports.map(r => {
            let lastEditor = '', lastDate = '';
            if (r.sections) {
                let latest = null;
                for (const key of Object.keys(r.sections)) {
                    const s = r.sections[key];
                    if (s.updated_at && (!latest || s.updated_at > latest.updated_at)) latest = s;
                }
                if (latest) { const u = users.find(u => u.id === latest.updated_by); lastEditor = u ? u.name : ''; lastDate = new Date(latest.updated_at).toLocaleDateString(); }
            }
            if (!lastDate && r.updated_at) lastDate = new Date(r.updated_at).toLocaleDateString();
            const vCount = (r.versions || []).length;
            const lockInfo = r.lock ? `<span style="font-size:11px;color:#e67e22;">Locked by ${esc(r.lock.user_name)}</span>` : '';
            return `<tr>
                <td>${esc(r.equipment_number || '-')}</td><td>${esc(r.project_name || '-')}</td>
                <td><span class="status-badge ${r.status}">${r.status.replace('_', ' ')}</span> ${lockInfo}</td>
                <td>${esc(lastEditor)}</td><td>${lastDate}</td>
                <td>
                    <button class="btn btn-sm" onclick="Library.openReport(${r.id})">Open</button>
                    ${vCount > 0 ? `<button class="btn btn-sm btn-outline" onclick="Library.showVersions(${r.id})">History (${vCount})</button>` : ''}
                    ${isAdmin ? `<button class="btn btn-sm btn-danger" onclick="Library.deleteReport(${r.id})">Delete</button>` : ''}
                    ${isAdmin && r.lock ? `<button class="btn btn-sm btn-warning" onclick="Library.forceUnlock(${r.id})">Force Unlock</button>` : ''}
                </td></tr>`;
        }).join('') || '<tr><td colspan="6" style="text-align:center;color:#aaa;">No in-progress reports.</td></tr>';
    }

    // ─── Review Queue ─────────────────────────────────────────────────────
    async function renderReview() {
        const tbody = document.getElementById('review-tbody');
        const emptyMsg = document.getElementById('review-empty');
        const [users, allReports] = await Promise.all([API.getUsers(), getReportsCached()]);
        updateReviewBadge(allReports);
        const reports = allReports.filter(r => r.status === 'in_review');

        if (reports.length === 0) {
            tbody.innerHTML = ''; emptyMsg.classList.remove('hidden'); return;
        }
        emptyMsg.classList.add('hidden');

        tbody.innerHTML = reports.map(r => {
            let submitter = '', submitDate = '';
            if (r.sections) {
                let latest = null;
                for (const key of Object.keys(r.sections)) {
                    const s = r.sections[key];
                    if (s.updated_at && (!latest || s.updated_at > latest.updated_at)) latest = s;
                }
                if (latest) { const u = users.find(u => u.id === latest.updated_by); submitter = u ? u.name : ''; submitDate = new Date(latest.updated_at).toLocaleDateString(); }
            }
            return `<tr>
                <td>${esc(r.equipment_number || '-')}</td><td>${esc(r.project_name || '-')}</td>
                <td>${esc(submitter)}</td><td>${submitDate}</td>
                <td><button class="btn btn-sm" onclick="Library.openReport(${r.id})">Open & Review</button></td>
            </tr>`;
        }).join('');
    }

    // ─── Final Reports ────────────────────────────────────────────────────
    async function renderFinal() {
        const tbody = document.getElementById('final-tbody');
        const emptyMsg = document.getElementById('final-empty');
        let finals = await API.getFinalReports();

        // Search filter
        const searchEl = document.getElementById('final-search');
        const searchText = searchEl ? searchEl.value.trim() : '';
        if (searchText) {
            const s = searchText.toLowerCase();
            finals = finals.filter(f => (f.equipment_number || '').toLowerCase().includes(s) || (f.project_name || '').toLowerCase().includes(s));
        }

        // Date range filter
        const fromEl = document.getElementById('final-date-from');
        const toEl = document.getElementById('final-date-to');
        if (fromEl && fromEl.value) {
            const from = new Date(fromEl.value + 'T00:00:00');
            finals = finals.filter(f => new Date(f.finalized_at) >= from);
        }
        if (toEl && toEl.value) {
            const to = new Date(toEl.value + 'T23:59:59');
            finals = finals.filter(f => new Date(f.finalized_at) <= to);
        }

        // Hide downloaded
        const hideEl = document.getElementById('final-hide-downloaded');
        const downloaded = getDownloaded();
        if (hideEl && hideEl.checked) {
            finals = finals.filter(f => !downloaded.includes(f.id));
        }

        // Sort
        const sortEl = document.getElementById('final-sort');
        const sortVal = sortEl ? sortEl.value : 'newest';
        if (sortVal === 'newest') finals.sort((a, b) => new Date(b.finalized_at) - new Date(a.finalized_at));
        else if (sortVal === 'oldest') finals.sort((a, b) => new Date(a.finalized_at) - new Date(b.finalized_at));
        else if (sortVal === 'equip-az') finals.sort((a, b) => (a.equipment_number || '').localeCompare(b.equipment_number || ''));
        else if (sortVal === 'equip-za') finals.sort((a, b) => (b.equipment_number || '').localeCompare(a.equipment_number || ''));

        if (finals.length === 0) { tbody.innerHTML = ''; emptyMsg.classList.remove('hidden'); return; }
        emptyMsg.classList.add('hidden');

        const isAdmin = Auth.isAdmin();
        tbody.innerHTML = finals.map(f => {
            const isDl = downloaded.includes(f.id);
            return `<tr data-final-id="${f.id}" style="${isDl ? 'opacity:0.6;' : ''}">
                <td><input type="checkbox" class="final-check" data-fid="${f.id}"></td>
                <td>${esc(f.equipment_number || '-')}</td><td>${esc(f.project_name || '-')}</td>
                <td>${esc(f.finalized_by_name)}</td><td>${new Date(f.finalized_at).toLocaleDateString()}</td>
                <td style="text-align:center;">${isDl ? '<span style="color:#27ae60;font-weight:700;font-size:11px;">Downloaded</span>' : '<span style="color:#e67e22;font-size:11px;">Pending</span>'}</td>
                <td>
                    <button class="btn btn-sm" onclick="Library.viewFinalReport(${f.id})">View</button>
                    <button class="btn btn-sm btn-primary" onclick="Library.downloadFinal(${f.id})">${isDl ? 'Re-download' : 'Download PDF'}</button>
                    ${isAdmin ? `<button class="btn btn-sm btn-danger" onclick="Library.deleteFinalReport(${f.id})">Delete</button>` : ''}
                </td>
            </tr>`;
        }).join('');
        updateDownloadBtn();
    }

    function updateDownloadBtn() {
        const checked = document.querySelectorAll('.final-check:checked').length;
        const btn = document.getElementById('btn-download-selected');
        if (btn) { btn.disabled = checked === 0; btn.textContent = checked > 0 ? `Download Selected (${checked})` : 'Download Selected'; }
    }

    async function downloadFinal(finalId) {
        // Fetch full final report data (pdf_data + sections_snapshot) on demand
        const f = await API.getFinalReport(finalId);
        if (!f) return;
        hide();
        // Try to load source report; if deleted, use snapshot
        let report = null;
        try {
            document.getElementById('report-selector').value = f.report_id;
            await App.loadReport(f.report_id, { skipAutoLock: true });
            report = App.getReport();
        } catch (e) { report = null; }
        // Fallback: build report object from the final snapshot
        if (!report && f.sections_snapshot) {
            report = {
                id: f.report_id || null,
                equipment_number: f.equipment_number,
                project_name: f.project_name,
                unit_number: f.unit_number,
                report_type: f.report_type,
                site_id: f.site_id,
                status: 'final',
                sections: f.sections_snapshot
            };
        }
        if (report) {
            await PDF.generate(report, { autoDownload: true });
            markDownloaded(finalId);
        } else {
            App.toast('Cannot download — source report and snapshot both missing.', 'error');
        }
    }

    async function downloadSelected() {
        const checked = document.querySelectorAll('.final-check:checked');
        if (checked.length === 0) return;
        const ids = Array.from(checked).map(c => parseInt(c.dataset.fid));
        for (const id of ids) {
            await downloadFinal(id);
        }
        App.toast(`${ids.length} PDF(s) downloaded.`, 'success');
    }

    async function viewFinalReport(finalId) {
        // Fetch full final report data (sections_snapshot) on demand
        const f = await API.getFinalReport(finalId);
        if (!f) return;
        hide();
        // Try to load source report first
        let sourceLoaded = false;
        try {
            document.getElementById('report-selector').value = f.report_id;
            await App.loadReport(f.report_id, { skipAutoLock: true });
            sourceLoaded = !!App.getReport();
        } catch (e) { sourceLoaded = false; }

        if (sourceLoaded && f.sections_snapshot) {
            App.viewVersion({
                version_id: 'Final',
                timestamp: f.finalized_at,
                user_name: f.finalized_by_name,
                section_snapshots: f.sections_snapshot
            });
        } else if (f.sections_snapshot) {
            // Source report deleted — offer to download instead
            if (confirm(`Source report for "${f.equipment_number}" was deleted.\n\nWould you like to download the finalized PDF instead?`)) {
                await downloadFinal(finalId);
            }
        } else {
            App.toast('No snapshot available for this report.', 'error');
        }
    }

    function openReport(id) { hide(); const s = document.getElementById('report-selector'); s.value = id; s.dispatchEvent(new Event('change')); }

    async function deleteReport(id) {
        if (!Auth.isAdmin()) return;
        if (!confirm('Permanently delete this report and all its data? This cannot be undone.')) return;
        await API.deleteReport(id);
        invalidateReportsCache();
        App.toast('Report deleted.', 'info');
        await renderProgress();
    }

    async function forceUnlock(id) {
        if (!Auth.isAdmin()) return;
        if (!confirm('Force release the lock on this report?')) return;
        await API.forceUnlock(id);
        invalidateReportsCache();
        App.toast('Lock released.', 'info');
        await renderProgress();
    }

    async function deleteFinalReport(id) {
        if (!Auth.isAdmin()) return;
        if (!confirm('Delete this final report from the library?')) return;
        await API.deleteFinalReport(id);
        App.toast('Final report deleted.', 'info');
        await renderFinal();
    }

    async function showVersions(reportId) {
        const versions = await API.getVersions(reportId);
        const list = document.getElementById('version-list');
        list.innerHTML = versions.length === 0
            ? '<p style="text-align:center;color:#aaa;">No versions saved yet.</p>'
            : versions.slice().reverse().map(v => `<div class="version-item"><div class="version-info"><strong>Version #${v.version_id}</strong><span>${new Date(v.timestamp).toLocaleString()}</span><span>by ${esc(v.user_name)}</span></div><button class="btn btn-sm btn-outline" onclick="Library.viewVersion(${reportId}, ${v.version_id})">View</button></div>`).join('');
        document.getElementById('version-modal').classList.remove('hidden');
    }

    async function viewVersion(reportId, versionId) {
        const versions = await API.getVersions(reportId);
        const version = versions.find(v => v.version_id === versionId);
        if (!version) return;
        document.getElementById('version-modal').classList.add('hidden');
        hide();
        const s = document.getElementById('report-selector'); s.value = reportId; s.dispatchEvent(new Event('change'));
        setTimeout(() => App.viewVersion(version), 200);
    }

    function esc(s) { if (!s) return ''; const d = document.createElement('div'); d.textContent = s; return d.innerHTML; }

    document.addEventListener('DOMContentLoaded', () => {
        const search = document.getElementById('lib-search');
        const filter = document.getElementById('lib-filter');
        if (search) search.addEventListener('input', () => renderProgress(filter.value, search.value).catch(console.error));
        if (filter) filter.addEventListener('change', () => renderProgress(filter.value, search.value).catch(console.error));
        const finalSearch = document.getElementById('final-search');
        if (finalSearch) finalSearch.addEventListener('input', () => renderFinal().catch(console.error));
        const finalSort = document.getElementById('final-sort');
        if (finalSort) finalSort.addEventListener('change', () => renderFinal().catch(console.error));
        const finalDateFrom = document.getElementById('final-date-from');
        const finalDateTo = document.getElementById('final-date-to');
        if (finalDateFrom) finalDateFrom.addEventListener('change', () => renderFinal().catch(console.error));
        if (finalDateTo) finalDateTo.addEventListener('change', () => renderFinal().catch(console.error));
        const hideDownloaded = document.getElementById('final-hide-downloaded');
        if (hideDownloaded) hideDownloaded.addEventListener('change', () => renderFinal().catch(console.error));
        document.querySelectorAll('.lib-tab').forEach(tab => tab.addEventListener('click', () => switchTab(tab.dataset.libtab)));
        const selectAllHead = document.getElementById('final-select-all-head');
        const selectAll = document.getElementById('final-select-all');
        [selectAllHead, selectAll].forEach(cb => { if (cb) cb.addEventListener('change', () => { document.querySelectorAll('.final-check').forEach(c => c.checked = cb.checked); if (selectAllHead && selectAll) { selectAllHead.checked = cb.checked; selectAll.checked = cb.checked; } updateDownloadBtn(); }); });
        const dlBtn = document.getElementById('btn-download-selected');
        if (dlBtn) dlBtn.addEventListener('click', downloadSelected);
        document.addEventListener('change', (e) => { if (e.target.classList.contains('final-check')) updateDownloadBtn(); });
        const closeBtn = document.getElementById('btn-close-versions');
        if (closeBtn) closeBtn.addEventListener('click', () => document.getElementById('version-modal').classList.add('hidden'));
    });

    return { show, hide, renderProgress, renderReview, renderFinal, openReport, showVersions, viewVersion, viewFinalReport, downloadFinal, downloadSelected, updateReviewBadge, deleteReport, forceUnlock, deleteFinalReport };
})();
