// ─── Authentication & Lock Management ──────────────────────────────────────
const Auth = (() => {
    let currentUser = null;
    let parentSites = null; // sites from task-tracker DB
    let parentAllowedSites = null; // user's allowed site IDs

    // Get auth token from parent task-tracker or shared localStorage
    function getToken() {
        try { if (window.parent && window.parent !== window && window.parent.authToken) return window.parent.authToken; } catch(e) {}
        try { const t = localStorage.getItem('authToken'); if (t) return t; } catch(e) {}
        try { const t = window.parent.sessionStorage.getItem('authToken'); if (t) return t; } catch(e) {}
        try { return sessionStorage.getItem('authToken') || ''; } catch(e) {}
        return '';
    }

    function authFetch(url, opts = {}) {
        if (!opts.headers) opts.headers = {};
        opts.headers['Authorization'] = 'Bearer ' + getToken();
        return fetch(url, opts);
    }

    // Try to get parent task-tracker user info (from parent window or localStorage)
    function getParentUser() {
        // Try window.parent first
        try {
            if (window.parent && window.parent !== window && window.parent.currentUser) {
                const pu = window.parent.currentUser;
                return mapParentUser(pu);
            }
        } catch (e) {}
        // Fallback: read from shared localStorage
        try {
            const raw = localStorage.getItem('currentUser');
            if (raw) {
                const pu = JSON.parse(raw);
                return mapParentUser(pu);
            }
        } catch(e) {}
        return null;
    }

    function mapParentUser(pu) {
        return {
            name: pu.username,
            role: pu.role === 'superadmin' ? 'Supervisor' : pu.role === 'admin' ? 'Engineer' : 'Inspector',
            is_admin: pu.role === 'superadmin' || pu.role === 'admin',
            allowedSites: pu.allowedSites || [],
            parentRole: pu.role,
            from_parent: true
        };
    }

    // Fetch sites from task-tracker DB and ensure they exist server-side in TIR
    async function loadParentSites() {
        try {
            const res = await authFetch('/reports/api/sites');
            if (res.ok) {
                parentSites = await res.json();
                // Ensure each parent site exists in the TIR API
                const existingSites = await API.getSites();
                for (const s of parentSites) {
                    const already = existingSites.find(es => es.client_name === s.name || es.plant_name === s.name);
                    if (!already) {
                        await API.createSite(s.name, s.name, '', null);
                    }
                }
            }
        } catch(e) { console.error('Failed to load parent sites:', e); }
    }

    // Assign allowed sites to user via the API
    async function syncSiteAccess(user, allowedSiteIds, isSuperadmin) {
        const allSites = await API.getSites();
        if (isSuperadmin) {
            user.site_ids = allSites.map(s => s.id);
        } else if (allowedSiteIds && allowedSiteIds.length > 0 && parentSites) {
            user.site_ids = [];
            for (const psId of allowedSiteIds) {
                const ps = parentSites.find(s => s.id === psId);
                if (ps) {
                    const tirSite = allSites.find(s => s.plant_name === ps.name || s.client_name === ps.name);
                    if (tirSite) {
                        user.site_ids.push(tirSite.id);
                        await API.assignUserToSite(user.id, tirSite.id);
                    }
                }
            }
        } else {
            user.site_ids = [];
        }
        await API.updateUser(user.id, { site_ids: user.site_ids });
    }

    return {
        async init() {
            // === Strategy 1: Read parent window user (iframe inside task-tracker) ===
            const parentUser = getParentUser();
            if (parentUser) {
                try {
                    const user = await API.login(parentUser.name, parentUser.role, '');

                    // Sync admin status from parent
                    if (parentUser.is_admin && !user.is_admin) {
                        try { await API.updateUser(user.id, { is_admin: true }); user.is_admin = true; } catch(e) { console.warn('Failed to sync admin:', e); }
                    }

                    // Load parent sites & sync access (non-fatal if fails)
                    try {
                        await loadParentSites();
                        await syncSiteAccess(user, parentUser.allowedSites, parentUser.parentRole === 'superadmin');
                    } catch(e) { console.warn('Site sync failed (non-fatal):', e); }

                    currentUser = user;
                    parentAllowedSites = parentUser.allowedSites;
                    sessionStorage.setItem('tir_user', JSON.stringify(user));
                    return currentUser;
                } catch(e) {
                    console.error('[Auth] Parent auth flow error:', e);
                    // Fall through to token-based auth
                }
            }

            // === Strategy 2: Token-based auth via /reports/api/me ===
            const token = getToken();
            if (token) {
                try {
                    const res = await authFetch('/reports/api/me');
                    if (res.ok) {
                        const me = await res.json();
                        const roleName = me.role === 'superadmin' ? 'Supervisor' : me.role === 'admin' ? 'Engineer' : 'Inspector';
                        const isAdmin = me.role === 'superadmin' || me.role === 'admin';

                        const user = await API.login(me.username, roleName, '');
                        if (isAdmin && !user.is_admin) {
                            try { await API.updateUser(user.id, { is_admin: true }); user.is_admin = true; } catch(e) {}
                        }

                        // Load sites & sync (non-fatal)
                        try {
                            await loadParentSites();
                            await syncSiteAccess(user, me.allowedSites, me.role === 'superadmin');
                        } catch(e) { console.warn('Site sync failed (non-fatal):', e); }

                        currentUser = user;
                        parentAllowedSites = me.allowedSites || [];
                        sessionStorage.setItem('tir_user', JSON.stringify(user));
                        return currentUser;
                    }
                } catch(e) { console.error('Token auth fallback failed:', e); }
            }

            // === Strategy 3: sessionStorage for standalone mode ===
            const raw = sessionStorage.getItem('tir_user');
            currentUser = raw ? JSON.parse(raw) : null;
            return currentUser;
        },
        async login(name, role, apiCert) {
            const user = await API.login(name, role, apiCert);
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
        async acquireLock(reportId) {
            if (!currentUser) throw new Error('Not logged in');
            return await API.acquireLock(reportId, currentUser.id);
        },
        async releaseLock(reportId) {
            if (!currentUser) throw new Error('Not logged in');
            return await API.releaseLock(reportId, currentUser.id);
        },
        hasLock(report) {
            if (!currentUser || !report || !report.lock) return false;
            return report.lock.user_id === currentUser.id;
        },
        authFetch,
    };
})();
