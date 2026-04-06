// ─── Library Dashboard & Version History ──────────────────────────────────

const Library = (() => {
    let activeTab = 'progress';

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

    function hide() { document.getElementById('library-container').classList.add('hidden'); }

    function switchTab(tab) {
        activeTab = tab;
        document.querySelectorAll('.lib-tab').forEach(t => t.classList.toggle('active', t.dataset.libtab === tab));
        document.getElementById('lib-tab-progress').classList.toggle('hidden', tab !== 'progress');
        document.getElementById('lib-tab-review').classList.toggle('hidden', tab !== 'review');
        document.getElementById('lib-tab-final').classList.toggle('hidden', tab !== 'final');
        if (tab === 'progress') renderProgress();
        else if (tab === 'review') renderReview();
        else renderFinal();
    }

    function updateReviewBadge() {
        const count = API.getReports().filter(r => r.status === 'in_review').length;
        const badge = document.getElementById('review-count');
        if (badge) badge.textContent = count > 0 ? count : '';
    }

    // ─── Progress Reports ─────────────────────────────────────────────────
    function renderProgress(filterStatus, searchText) {
        updateReviewBadge();
        const tbody = document.getElementById('lib-tbody');
        const users = API.getUsers();
        let reports = API.getReports().filter(r => r.status !== 'final' && r.status !== 'in_review');
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
    function renderReview() {
        updateReviewBadge();
        const tbody = document.getElementById('review-tbody');
        const emptyMsg = document.getElementById('review-empty');
        const users = API.getUsers();
        const reports = API.getReports().filter(r => r.status === 'in_review');

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
    function renderFinal(searchText) {
        const tbody = document.getElementById('final-tbody');
        const emptyMsg = document.getElementById('final-empty');
        let finals = API.getFinalReports();

        if (searchText) {
            const s = searchText.toLowerCase();
            finals = finals.filter(f => (f.equipment_number || '').toLowerCase().includes(s) || (f.project_name || '').toLowerCase().includes(s));
        }
        if (finals.length === 0) { tbody.innerHTML = ''; emptyMsg.classList.remove('hidden'); return; }
        emptyMsg.classList.add('hidden');

        const isAdmin = Auth.isAdmin();
        tbody.innerHTML = finals.slice().reverse().map(f => `
            <tr data-final-id="${f.id}">
                <td><input type="checkbox" class="final-check" data-fid="${f.id}"></td>
                <td>${esc(f.equipment_number || '-')}</td><td>${esc(f.project_name || '-')}</td>
                <td>${esc(f.finalized_by_name)}</td><td>${new Date(f.finalized_at).toLocaleDateString()}</td>
                <td>
                    <button class="btn btn-sm" onclick="Library.viewFinalReport(${f.id})">View</button>
                    <button class="btn btn-sm btn-primary" onclick="Library.downloadFinal(${f.id})">Download PDF</button>
                    ${isAdmin ? `<button class="btn btn-sm btn-danger" onclick="Library.deleteFinalReport(${f.id})">Delete</button>` : ''}
                </td>
            </tr>`).join('');
        updateDownloadBtn();
    }

    function updateDownloadBtn() {
        const checked = document.querySelectorAll('.final-check:checked').length;
        const btn = document.getElementById('btn-download-selected');
        if (btn) { btn.disabled = checked === 0; btn.textContent = checked > 0 ? `Download Selected (${checked})` : 'Download Selected'; }
    }

    function downloadFinal(finalId) {
        const finals = API.getFinalReports();
        const f = finals.find(r => r.id === finalId);
        if (!f) return;
        hide();
        const select = document.getElementById('report-selector');
        select.value = f.report_id;
        select.dispatchEvent(new Event('change'));
        setTimeout(() => PDF.generate({ equipment_number: f.equipment_number }, { autoDownload: true }), 500);
    }

    function downloadSelected() {
        const checked = document.querySelectorAll('.final-check:checked');
        if (checked.length === 0) return;
        const ids = Array.from(checked).map(c => parseInt(c.dataset.fid));
        let i = 0;
        function next() { if (i >= ids.length) { App.toast(`${ids.length} PDF(s) queued.`, 'success'); return; } downloadFinal(ids[i]); i++; if (i < ids.length) setTimeout(next, 2000); }
        next();
    }

    function viewFinalReport(finalId) {
        const finals = API.getFinalReports();
        const f = finals.find(r => r.id === finalId);
        if (!f) return;
        hide();
        const select = document.getElementById('report-selector');
        select.value = f.report_id;
        select.dispatchEvent(new Event('change'));
        if (f.sections_snapshot) {
            setTimeout(() => App.viewVersion({ version_id: 'Final', timestamp: f.finalized_at, user_name: f.finalized_by_name, section_snapshots: f.sections_snapshot }), 300);
        }
    }

    function openReport(id) { hide(); const s = document.getElementById('report-selector'); s.value = id; s.dispatchEvent(new Event('change')); }

    function deleteReport(id) {
        if (!Auth.isAdmin()) return;
        if (!confirm('Permanently delete this report and all its data? This cannot be undone.')) return;
        API.deleteReport(id);
        App.toast('Report deleted.', 'info');
        renderProgress();
    }

    function forceUnlock(id) {
        if (!Auth.isAdmin()) return;
        if (!confirm('Force release the lock on this report?')) return;
        API.forceUnlock(id);
        App.toast('Lock released.', 'info');
        renderProgress();
    }

    function deleteFinalReport(id) {
        if (!Auth.isAdmin()) return;
        if (!confirm('Delete this final report from the library?')) return;
        API.deleteFinalReport(id);
        App.toast('Final report deleted.', 'info');
        renderFinal();
    }

    function showVersions(reportId) {
        const versions = API.getVersions(reportId);
        const list = document.getElementById('version-list');
        list.innerHTML = versions.length === 0
            ? '<p style="text-align:center;color:#aaa;">No versions saved yet.</p>'
            : versions.slice().reverse().map(v => `<div class="version-item"><div class="version-info"><strong>Version #${v.version_id}</strong><span>${new Date(v.timestamp).toLocaleString()}</span><span>by ${esc(v.user_name)}</span></div><button class="btn btn-sm btn-outline" onclick="Library.viewVersion(${reportId}, ${v.version_id})">View</button></div>`).join('');
        document.getElementById('version-modal').classList.remove('hidden');
    }

    function viewVersion(reportId, versionId) {
        const version = API.getVersions(reportId).find(v => v.version_id === versionId);
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
        if (search) search.addEventListener('input', () => renderProgress(filter.value, search.value));
        if (filter) filter.addEventListener('change', () => renderProgress(filter.value, search.value));
        const finalSearch = document.getElementById('final-search');
        if (finalSearch) finalSearch.addEventListener('input', () => renderFinal(finalSearch.value));
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
