// Shared mutable application state accessible across route modules.
// All route modules import from here instead of relying on server.js closures.

function emptySection(label) {
  return { label, weights: [], infoCols: [], taskCols: [], rows: [], originalHeaders: [] };
}

function getDefaultState() {
  return {
    initials: [],
    sections: {
      PIPE: emptySection('PIPE'),
      PV: emptySection('PV'),
      PSV: emptySection('PSV')
    },
    activeSection: 'PIPE',
    billing: { po: 0, rate: 0, timesheet: [] },
    page: 0,
    pageSize: 100
  };
}

// Mutable state
let users = [];
let sites = [];
let activeSiteId = '';
let activeAppId = 1;
let state = getDefaultState();

module.exports = {
  emptySection,
  getDefaultState,

  getUsers() { return users; },
  setUsers(u) { users = u; },

  getSites() { return sites; },
  setSites(s) { sites = s; },

  getActiveSiteId() { return activeSiteId; },
  setActiveSiteId(id) { activeSiteId = id; },

  getActiveAppId() { return activeAppId; },
  setActiveAppId(id) { activeAppId = id; },

  getState() { return state; },
  setState(s) { state = s; },
};
