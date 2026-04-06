// ─── Authentication & Lock Management ──────────────────────────────────────

const Auth = (() => {
    let currentUser = null;
    let parentSites = null; // sites from task-tracker DB
    let parentAllowedSites = null; // user's allowed site IDs

    // Get auth token from parent task-tracker
    function getToken() {
        try { if (window.parent && window.parent.authToken) return window.parent.authToken; } catch(e) {}
        try { const t = window.parent.sessionStorage.getItem('authToken'); if (t) return t; } catch(e) {}
        try { return sessionStorage.getItem('authToken') || ''; } catch(e) {}
        return '';
    }

    function authFetch(url, opts = {}) {
        if (!opts.headers) opts.headers = {};
        opts.headers['Authorization'] = 'Bearer ' + getToken();
        return fetch(url, opts);
    }

    // Try to get parent task-tracker user info (when running inside iframe)
    function getParentUser() {
        try {
            if (window.parent && window.parent !== window && window.parent.currentUser) {
                const pu = window.parent.currentUser;
                return {
                    name: pu.username,
                    role: pu.role === 'superadmin' ? 'Supervisor' : pu.role === 'admin' ? 'Engineer' : 'Inspector',
                    is_admin: pu.role === 'superadmin' || pu.role === 'admin',
                    allowedSites: pu.allowedSites || [],
                    parentRole: pu.role,
                    from_parent: true
                };
            }
        } catch (e) {}
        return null;
    }

    // Fetch sites from task-tracker DB
    async function loadParentSites() {
        try {
            const res = await authFetch('/reports/api/sites');
            if (res.ok) {
                parentSites = await res.json();
                // Sync sites to localStorage API so reports can use them
                const data = JSON.parse(localStorage.getItem('tir_data') || '{}');
                if (!data.sites) data.sites = [];
                parentSites.forEach(s => {
                    const existing = data.sites.find(ls => ls.id === s.id || ls.plant_name === s.name);
                    if (!existing) {
                        data.sites.push({
                            id: s.id || data.sites.length + 1,
                            client_name: s.name,
                            plant_name: s.name,
                            location: '',
                            db_site_id: s.id,
                            enabled_types: ['tower','exchanger','aircooler','drum','heater','ext510','ext570'],
                            created_at: new Date().toISOString()
                        });
                    }
                });
                if (!data.nextSiteId) data.nextSiteId = 1;
                data.nextSiteId = Math.max(data.nextSiteId, ...data.sites.map(s => (typeof s.id === 'number' ? s.id : 0) + 1));
                localStorage.setItem('tir_data', JSON.stringify(data));
            }
        } catch(e) { console.error('Failed to load parent sites:', e); }
    }

    return {
        async init() {
            // First check if running inside task-tracker iframe
            const parentUser = getParentUser();
            if (parentUser) {
                // Load sites from task-tracker DB
                await loadParentSites();

                // Auto-login using parent credentials
                const user = API.login(parentUser.name, parentUser.role, '');
                // Sync admin status from parent
                if (parentUser.is_admin && !user.is_admin) {
                    API.updateUser(user.id, { is_admin: true });
                    user.is_admin = true;
                }

                // Sync site access - assign user to their allowed sites
                if (parentUser.parentRole === 'superadmin') {
                    // Superadmin gets all sites
                    const allSites = API.getSites();
                    user.site_ids = allSites.map(s => s.id);
                } else if (parentUser.allowedSites.length > 0 && parentSites) {
                    // Map parent allowed site IDs to local site IDs
                    const data = JSON.parse(localStorage.getItem('tir_data') || '{}');
                    const localSites = data.sites || [];
                    user.site_ids = [];
                    parentUser.allowedSites.forEach(psId => {
                        const ps = parentSites.find(s => s.id === psId);
                        if (ps) {
                            const ls = localSites.find(s => s.db_site_id === ps.id || s.plant_name === ps.name);
                            if (ls) user.site_ids.push(ls.id);
                        }
                    });
                } else {
                    user.site_ids = [];
                }
                API.updateUser(user.id, { site_ids: user.site_ids });

                currentUser = user;
                parentAllowedSites = parentUser.allowedSites;
                sessionStorage.setItem('tir_user', JSON.stringify(user));
                return currentUser;
            }
            // Fallback: check sessionStorage for standalone mode
            const raw = sessionStorage.getItem('tir_user');
            currentUser = raw ? JSON.parse(raw) : null;
            return currentUser;
        },
        login(name, role, apiCert) {
            const user = API.login(name, role, apiCert);
            currentUser = user;
            sessionStorage.setItem('tir_user', JSON.stringify(user));
            return user;
        },
        logout() { currentUser = null; sessionStorage.removeItem('tir_user'); },
        getUser() { return currentUser; },
        isLoggedIn() { return !!currentUser; },
        isAdmin() { return currentUser && currentUser.is_admin; },
        isInIframe() {
            try { return window.parent && window.parent !== window && !!window.parent.currentUser; }
            catch (e) { return false; }
        },
        getParentSites() { return parentSites; },
        acquireLock(reportId) {
            if (!currentUser) throw new Error('Not logged in');
            return API.acquireLock(reportId, currentUser.id);
        },
        releaseLock(reportId) {
            if (!currentUser) throw new Error('Not logged in');
            return API.releaseLock(reportId, currentUser.id);
        },
        hasLock(report) {
            if (!currentUser || !report || !report.lock) return false;
            return report.lock.user_id === currentUser.id;
        },
        authFetch,
    };
})();
