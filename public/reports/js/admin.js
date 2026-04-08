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
        tbody.innerHTML = users.map(u => {
            const userSites = sites.filter(s => (u.site_ids || []).includes(s.id));
            const siteNames = userSites.map(s => s.plant_name).join(', ') || '<em style="color:#aaa">None</em>';
            return `<tr>
                <td>${esc(u.name)}</td>
                <td>${esc(u.role)}</td>
                <td>${esc(u.api_cert || '')}</td>
                <td>${u.is_admin ? '<span class="status-badge approved">Admin</span>' : ''}</td>
                <td style="font-size:11px;">${siteNames}</td>
                <td>${u.id !== me.id ? `<button class="btn btn-sm btn-danger" onclick="Admin.deleteUser(${u.id})">Delete</button>` : '<em>You</em>'}</td>
            </tr>`;
        }).join('');
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
            });
        });
    });

    return { open, close, deleteUser, deleteSite, renderSites, saveAllSites };
})();
