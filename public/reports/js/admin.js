// ─── Admin Panel ──────────────────────────────────────────────────────────

const Admin = (() => {
    const ALL_TYPES = [
        { key: 'tower', label: 'Tower / Column' },
        { key: 'exchanger', label: 'Exchanger' },
        { key: 'aircooler', label: 'Air Cooler (Finfan)' },
        { key: 'drum', label: 'Drum' },
        { key: 'heater', label: 'Heater / Boiler' },
        { key: 'ext510', label: '510 External Inspection' },
        { key: 'ext570', label: '570 External Inspection' },
    ];

    async function open() {
        if (!Auth.isAdmin()) return;
        document.getElementById('admin-modal').classList.remove('hidden');
        await renderUsers();
        await renderSites();
        await renderReports();
    }

    function close() { document.getElementById('admin-modal').classList.add('hidden'); }

    // ─── Users ────────────────────────────────────────────────────────────
    async function renderUsers() {
        const tbody = document.getElementById('admin-users-tbody');
        const users = await API.getUsers();
        const sites = await API.getSites();
        const me = Auth.getUser();
        const roles = ['Inspector', 'Lead Inspector', 'Engineer', 'Supervisor'];
        tbody.innerHTML = users.map(u => {
            const userSites = sites.filter(s => (u.site_ids || []).includes(s.id));
            const siteNames = userSites.map(s => s.plant_name).join(', ') || '<em style="color:#aaa">None</em>';
            const roleOpts = roles.map(r => `<option value="${r}" ${u.role === r ? 'selected' : ''}>${r}</option>`).join('');
            return `<tr data-uid="${u.id}">
                <td><input type="text" class="admin-edit-name" value="${esc(u.name)}" style="border:1px solid #ddd;padding:2px 4px;width:100%;font-size:inherit;"></td>
                <td><select class="admin-edit-role" style="border:1px solid #ddd;padding:2px;font-size:inherit;">${roleOpts}</select></td>
                <td><input type="text" class="admin-edit-cert" value="${esc(u.api_cert || '')}" style="border:1px solid #ddd;padding:2px 4px;width:100%;font-size:inherit;"></td>
                <td><label style="cursor:pointer;"><input type="checkbox" class="admin-edit-admin" ${u.is_admin ? 'checked' : ''}> Admin</label></td>
                <td style="font-size:11px;">${siteNames}</td>
                <td style="white-space:nowrap;">
                    <button class="btn btn-sm btn-primary admin-save-user" style="margin-right:4px;">Save</button>
                    ${u.id !== me.id ? `<button class="btn btn-sm btn-danger" onclick="Admin.deleteUser(${u.id})">Delete</button>` : '<em>You</em>'}
                </td>
            </tr>`;
        }).join('');

        // Bind save buttons
        tbody.querySelectorAll('.admin-save-user').forEach(btn => {
            btn.addEventListener('click', async () => {
                const row = btn.closest('tr');
                const uid = parseInt(row.dataset.uid);
                const name = row.querySelector('.admin-edit-name').value.trim();
                const role = row.querySelector('.admin-edit-role').value;
                const cert = row.querySelector('.admin-edit-cert').value.trim();
                const isAdmin = row.querySelector('.admin-edit-admin').checked;
                if (!name) { App.toast('Name cannot be empty', 'error'); return; }
                try {
                    btn.textContent = 'Saving...';
                    btn.disabled = true;
                    await API.updateUser(uid, { name, role, api_cert: cert, is_admin: isAdmin });
                    btn.textContent = '✓ Saved!';
                    btn.style.background = '#27ae60';
                    btn.style.color = '#fff';
                    await new Promise(r => setTimeout(r, 1000));
                    await renderUsers();
                } catch (e) {
                    btn.textContent = 'Save';
                    btn.disabled = false;
                    App.toast('Save failed: ' + e.message, 'error');
                }
            });
        });
    }

    // ─── Sites ────────────────────────────────────────────────────────────
    async function renderSites() {
        const container = document.getElementById('sites-list');
        const sites = await API.getSites();
        const users = await API.getUsers();

        if (sites.length === 0) {
            container.innerHTML = '<p style="color:#aaa;text-align:center;padding:16px;">No sites created yet.</p>';
            return;
        }

        container.innerHTML = sites.map(s => {
            const typeChecks = ALL_TYPES.map(t =>
                `<label class="site-type-check"><input type="checkbox" data-site="${s.id}" data-type="${t.key}" ${(s.enabled_types || []).includes(t.key) ? 'checked' : ''}> ${t.label}</label>`
            ).join('');

            const userChecks = users.map(u =>
                `<label class="site-user-check"><input type="checkbox" data-site="${s.id}" data-uid="${u.id}" ${(u.site_ids || []).includes(s.id) ? 'checked' : ''}> ${esc(u.name)}</label>`
            ).join('');

            return `<div class="site-card">
                <div class="site-card-header">
                    <strong>${esc(s.client_name)}</strong> — ${esc(s.plant_name)}
                    <span style="font-size:11px;color:#888;margin-left:8px;">${esc(s.location || '')}</span>
                    <button class="btn btn-sm btn-danger" style="margin-left:auto;" onclick="Admin.deleteSite(${s.id})">Delete</button>
                </div>
                <div class="site-card-body">
                    <div class="site-config-col">
                        <label class="site-config-label">Enabled Report Types:</label>
                        <div class="site-checks">${typeChecks}</div>
                    </div>
                    <div class="site-config-col">
                        <label class="site-config-label">Assigned Users:</label>
                        <div class="site-checks">${userChecks}</div>
                    </div>
                </div>
            </div>`;
        }).join('');

        // Bind type toggles
        container.querySelectorAll('[data-site][data-type]').forEach(cb => {
            cb.addEventListener('change', async () => {
                const siteId = parseSiteId(cb.dataset.site);
                const sites = await API.getSites();
                const site = sites.find(s => s.id === siteId);
                if (!site) return;
                let types = site.enabled_types || [];
                if (cb.checked) { if (!types.includes(cb.dataset.type)) types.push(cb.dataset.type); }
                else { types = types.filter(t => t !== cb.dataset.type); }
                await API.updateSite(siteId, { enabled_types: types });
            });
        });

        // Bind user assignment toggles
        container.querySelectorAll('[data-site][data-uid]').forEach(cb => {
            cb.addEventListener('change', async () => {
                const siteId = parseSiteId(cb.dataset.site);
                const userId = parseInt(cb.dataset.uid);
                if (cb.checked) await API.assignUserToSite(userId, siteId);
                else await API.removeUserFromSite(userId, siteId);
                await renderUsers(); // refresh user table to show site assignments
            });
        });
    }

    // Save all site settings at once (batch save)
    async function saveAllSites() {
        const container = document.getElementById('sites-list');
        if (!container) return;

        // Save enabled types per site
        const sites = await API.getSites();
        const siteTypes = {};
        sites.forEach(s => { siteTypes[s.id] = []; });

        container.querySelectorAll('[data-site][data-type]').forEach(cb => {
            const siteId = parseSiteId(cb.dataset.site);
            if (!siteTypes[siteId]) siteTypes[siteId] = [];
            if (cb.checked) siteTypes[siteId].push(cb.dataset.type);
        });

        for (const sid of Object.keys(siteTypes)) {
            const siteId = parseSiteId(sid);
            try { await API.updateSite(siteId, { enabled_types: siteTypes[sid] }); } catch(e) {}
        }

        // Save user assignments per site
        for (const cb of container.querySelectorAll('[data-site][data-uid]')) {
            const siteId = parseSiteId(cb.dataset.site);
            const userId = parseInt(cb.dataset.uid);
            if (cb.checked) await API.assignUserToSite(userId, siteId);
            else await API.removeUserFromSite(userId, siteId);
        }

        await renderUsers();
        App.toast('Site settings saved', 'success');
    }

    // Parse site ID - handles both numeric and string IDs (module-level)
    function parseSiteId(raw) {
        const n = parseInt(raw);
        return isNaN(n) ? raw : n;
    }

    async function deleteSite(siteId) {
        if (!confirm('Delete this site? Reports will keep their data but lose site assignment.')) return;
        await API.deleteSite(siteId);
        await renderSites();
        App.toast('Site deleted', 'info');
        if (typeof App.loadSiteSelector === 'function') App.loadSiteSelector();
    }

    // ─── Reports ──────────────────────────────────────────────────────────
    async function renderReports() {
        const tbody = document.getElementById('admin-reports-tbody');
        const reports = await API.getReports();
        const sites = await API.getSites();
        tbody.innerHTML = reports.map(r => {
            const site = sites.find(s => s.id === r.site_id);
            const siteName = site ? `${site.client_name} - ${site.plant_name}` : '<em style="color:#aaa">No site</em>';
            return `<tr>
                <td>${esc(r.equipment_number || '')}</td>
                <td>${esc(r.project_name || '')}</td>
                <td style="font-size:11px;">${siteName}</td>
                <td><span class="status-badge ${r.status}">${r.status.replace('_', ' ')}</span></td>
                <td>
                    <select class="admin-status-select" data-rid="${r.id}">
                        <option value="draft" ${r.status === 'draft' ? 'selected' : ''}>Draft</option>
                        <option value="in_review" ${r.status === 'in_review' ? 'selected' : ''}>In Review</option>
                        <option value="approved" ${r.status === 'approved' ? 'selected' : ''}>Approved</option>
                        <option value="final" ${r.status === 'final' ? 'selected' : ''}>Final</option>
                    </select>
                </td>
            </tr>`;
        }).join('');

        tbody.querySelectorAll('.admin-status-select').forEach(sel => {
            sel.addEventListener('change', async () => {
                try {
                    await API.updateReportStatus(parseInt(sel.dataset.rid), sel.value, Auth.getUser().id);
                    App.toast('Status updated', 'success');
                    await renderReports();
                } catch (e) { App.toast(e.message, 'error'); }
            });
        });
    }

    async function deleteUser(userId) {
        if (!confirm('Delete this user?')) return;
        try { await API.deleteUser(userId); await renderUsers(); App.toast('User deleted', 'success'); }
        catch (e) { App.toast(e.message, 'error'); }
    }

    // ─── Activity Log ────────────────────────────────────────────────────
    let activityPage = 1;
    const activityLimit = 50;
    let activityTotal = 0;

    async function loadActivityLog(page, clearFilters) {
        if (page) activityPage = page;
        if (clearFilters) {
            const af = document.getElementById('activity-filter-action');
            const uf = document.getElementById('activity-filter-user');
            if (af) af.value = '';
            if (uf) uf.value = '';
        }
        const filters = {};
        const actionEl = document.getElementById('activity-filter-action');
        const userEl = document.getElementById('activity-filter-user');
        if (actionEl && actionEl.value) filters.action = actionEl.value;
        if (userEl && userEl.value.trim()) filters.username = userEl.value.trim();

        const result = await API.getActivityLog(activityPage, activityLimit, filters);
        activityTotal = result.total;
        const tbody = document.getElementById('activity-tbody');

        const actionLabels = {
            tir_login: 'Login',
            report_create: 'Create Report',
            report_save_section: 'Save Section',
            report_status: 'Status Change',
            report_lock: 'Lock Report',
            report_finalize: 'Finalize',
            report_delete: 'Delete Report'
        };

        tbody.innerHTML = result.rows.length === 0
            ? '<tr><td colspan="4" style="text-align:center;color:#aaa;">No activity logged yet.</td></tr>'
            : result.rows.map(r => {
                const time = new Date(r.createdAt).toLocaleString();
                const label = actionLabels[r.action] || r.action;
                let details = '';
                if (r.details) {
                    const d = r.details;
                    const parts = [];
                    if (d.equipment) parts.push('Equipment: ' + d.equipment);
                    if (d.reportId) parts.push('Report #' + d.reportId);
                    if (d.section) parts.push('Section: ' + d.section);
                    if (d.status) parts.push('Status: ' + d.status);
                    if (d.tirUser) parts.push('TIR User: ' + d.tirUser);
                    if (d.role) parts.push('Role: ' + d.role);
                    if (d.type) parts.push('Type: ' + d.type);
                    details = parts.join(', ');
                }
                return `<tr>
                    <td style="font-size:11px;white-space:nowrap;">${esc(time)}</td>
                    <td>${esc(r.username || '-')}</td>
                    <td><span class="status-badge ${r.action.includes('delete') ? 'rejected' : r.action.includes('finalize') ? 'approved' : 'draft'}">${esc(label)}</span></td>
                    <td style="font-size:11px;">${esc(details)}</td>
                </tr>`;
            }).join('');

        const totalPages = Math.ceil(activityTotal / activityLimit);
        const info = document.getElementById('activity-page-info');
        if (info) info.textContent = `Page ${activityPage} of ${totalPages || 1} (${activityTotal} entries)`;
        const prev = document.getElementById('activity-prev');
        const next = document.getElementById('activity-next');
        if (prev) prev.disabled = activityPage <= 1;
        if (next) next.disabled = activityPage >= totalPages;
    }

    function activityPrev() { if (activityPage > 1) loadActivityLog(activityPage - 1); }
    function activityNext() { loadActivityLog(activityPage + 1); }

    function esc(s) { if (!s) return ''; const d = document.createElement('div'); d.textContent = s; return d.innerHTML; }

    // Bind events
    document.addEventListener('DOMContentLoaded', () => {
        const form = document.getElementById('admin-add-user');
        if (form) form.addEventListener('submit', async (e) => {
            e.preventDefault();
            const name = document.getElementById('au-name').value.trim();
            if (!name) return;
            try {
                await API.createUser(name, document.getElementById('au-role').value,
                    document.getElementById('au-cert').value.trim(), document.getElementById('au-admin').checked);
                form.reset(); await renderUsers(); await renderSites();
                App.toast('User created', 'success');
            } catch (e) { App.toast(e.message, 'error'); }
        });

        const siteForm = document.getElementById('admin-add-site');
        if (siteForm) siteForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            const client = document.getElementById('as-client').value.trim();
            const plant = document.getElementById('as-plant').value.trim();
            const loc = document.getElementById('as-location').value.trim();
            if (!client || !plant) return;
            await API.createSite(client, plant, loc);
            siteForm.reset(); await renderSites();
            if (typeof App.loadSiteSelector === 'function') App.loadSiteSelector();
            App.toast('Site created', 'success');
        });

        const closeBtn = document.getElementById('btn-close-admin');
        if (closeBtn) closeBtn.addEventListener('click', close);

        document.querySelectorAll('.admin-tab').forEach(tab => {
            tab.addEventListener('click', () => {
                document.querySelectorAll('.admin-tab').forEach(t => t.classList.remove('active'));
                document.querySelectorAll('.admin-tab-content').forEach(c => c.classList.add('hidden'));
                tab.classList.add('active');
                document.getElementById('admin-tab-' + tab.dataset.tab).classList.remove('hidden');
                if (tab.dataset.tab === 'activity') loadActivityLog(1).catch(console.error);
            });
        });
    });

    return { open, close, deleteUser, deleteSite, renderSites, saveAllSites, loadActivityLog, activityPrev, activityNext };
})();
