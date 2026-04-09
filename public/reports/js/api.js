// ─── Server-backed API Layer (PostgreSQL) ─────────────────────────────────
// All data stored on server — shared across all devices

const API = (() => {
    const BASE = '/reports/api/tir';

    // Auth fetch helper — uses Auth.authFetch if available, else plain fetch
    function af(url, opts = {}) {
        if (typeof Auth !== 'undefined' && Auth.authFetch) return Auth.authFetch(url, opts);
        return fetch(url, opts);
    }

    function jsonPost(url, body) {
        return af(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    }
    function jsonPut(url, body) {
        return af(url, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    }
    function jsonDelete(url, body) {
        const opts = { method: 'DELETE' };
        if (body) { opts.headers = { 'Content-Type': 'application/json' }; opts.body = JSON.stringify(body); }
        return af(url, opts);
    }

    async function handleRes(res) {
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Request failed');
        return data;
    }

    return {
        // ─── Users ────────────────────────────────────────────────────────
        async login(name, role, api_cert) {
            const res = await jsonPost(`${BASE}/login`, { name, role, api_cert });
            return handleRes(res);
        },

        async getUsers() {
            const res = await af(`${BASE}/users`);
            return handleRes(res);
        },

        async createUser(name, role, api_cert, is_admin) {
            const res = await jsonPost(`${BASE}/users`, { name, role, api_cert: api_cert || '', is_admin: !!is_admin });
            return handleRes(res);
        },

        async deleteUser(userId) {
            const res = await jsonDelete(`${BASE}/users/${userId}`);
            return handleRes(res);
        },

        async updateUser(userId, fields) {
            const res = await jsonPut(`${BASE}/users/${userId}`, fields);
            return handleRes(res);
        },

        // ─── Reports ─────────────────────────────────────────────────────
        async getReports() {
            const res = await af(`${BASE}/reports`);
            return handleRes(res);
        },

        // Report type configurations (pure client-side, no DB needed)
        getReportTypeConfig(type) {
            const configs = {
                tower: {
                    title: 'TOWER INSPECTION REPORT',
                    formNumber: 'FER-PROJ-FORM-01',
                    headerFields: [
                        ['Equipment Name:', 'equipment_name', null, null],
                        ['Equipment Type:', 'equipment_type', null, null],
                        ['Shell Material:', 'shell_material', 'Shell Thickness:', 'shell_thickness'],
                        ['Height:', 'height', 'Internal Diameter:', 'internal_diameter'],
                        ['Head Material:', 'head_material', 'Head Thickness:', 'head_thickness'],
                        ['Cladding/Lining Material:', 'cladding_material', 'NDE Performed:', 'nde_performed'],
                        ['Stress Relieved:', 'stress_relieved', 'Corrosion Allowance:', 'corrosion_allowance'],
                        ['Acceptance Criteria:', 'acceptance_criteria', null, null],
                    ],
                    headerDefaults: {
                        equipment_name: 'COMBINATION TOWER', equipment_type: 'Column',
                        shell_material: 'A-285C', shell_thickness: '7/16',
                        head_material: 'A-285C', head_thickness: '7/16',
                        cladding_material: 'None', corrosion_allowance: '.250',
                        acceptance_criteria: 'API 510, ASME VIII Div. 1',
                    },
                    narrativeSections: [
                        { key: 'summary', title: 'SUMMARY' },
                        { key: 'repairs', title: 'REPAIRS' },
                        { key: 'future_recommendations', title: 'FUTURE RECOMMENDATIONS' },
                        { key: 'shell', title: 'SHELL' },
                        { key: 'heads', title: 'HEADS' },
                        { key: 'nozzles', title: 'NOZZLES' },
                        { key: 'trays', title: 'TRAYS' },
                        { key: 'internal_piping', title: 'INTERNAL PIPING' },
                        { key: 'clad_overlay', title: 'CLAD / OVERLAY' },
                        { key: 'external_inspection', title: 'EXTERNAL' },
                    ],
                },
                exchanger: {
                    title: 'EXCHANGER INSPECTION REPORT',
                    formNumber: 'FER-PROJ-FORM-02',
                    headerFields: [
                        ['Equipment Name:', 'equipment_name', null, null],
                        ['Equipment Type:', 'equipment_type', null, null],
                        ['Shell Material:', 'shell_material', 'Shell Thickness:', 'shell_thickness'],
                        ['Cladding/Lining Material:', 'cladding_material', 'Internal Diameter:', 'internal_diameter'],
                        ['Tube Material:', 'tube_material', 'Tube Thickness:', 'tube_thickness'],
                        ['ECT Performed / Method:', 'ect_performed', 'Test Pressure:', 'test_pressure'],
                    ],
                    headerDefaults: {
                        equipment_type: 'Exchanger',
                        acceptance_criteria: 'API 510, ASME VIII Div. 1',
                    },
                    narrativeSections: [
                        { key: 'summary', title: 'SUMMARY' },
                        { key: 'repairs', title: 'REPAIRS' },
                        { key: 'future_recommendations', title: 'FUTURE RECOMMENDATIONS' },
                        { key: 'shell', title: 'SHELL' },
                        { key: 'shell_cover', title: 'SHELL COVER' },
                        { key: 'channel_head', title: 'CHANNEL HEAD' },
                        { key: 'channel_cover', title: 'CHANNEL COVER' },
                        { key: 'floating_head', title: 'FLOATING HEAD' },
                        { key: 'bundle', title: 'BUNDLE' },
                        { key: 'eddy_current', title: 'EDDY CURRENT RESULTS' },
                        { key: 'external_inspection', title: 'EXTERNAL' },
                    ],
                },
                aircooler: {
                    title: 'AIR COOLER INSPECTION REPORT',
                    formNumber: 'FER-PROJ-FORM-03',
                    headerFields: [
                        ['Equipment Name:', 'equipment_name', null, null],
                        ['Equipment Type:', 'equipment_type', null, null],
                        ['Header Box Material:', 'header_box_material', 'Header Box Thickness:', 'header_box_thickness'],
                        ['Tube Sheet Material:', 'tube_sheet_material', 'Tube Sheet Thickness:', 'tube_sheet_thickness'],
                        ['Tube Material:', 'tube_material', 'Tube Thickness:', 'tube_thickness'],
                        ['Total Tubes:', 'total_tubes', 'ECT Performed / Method:', 'ect_performed'],
                        ['Test Pressure:', 'test_pressure', null, null],
                    ],
                    headerDefaults: { equipment_type: 'Air Cooler' },
                    narrativeSections: [
                        { key: 'summary', title: 'SUMMARY' },
                        { key: 'repairs', title: 'REPAIRS' },
                        { key: 'future_recommendations', title: 'FUTURE RECOMMENDATIONS' },
                        { key: 'header_boxes', title: 'HEADER BOXES' },
                        { key: 'tube_sheets', title: 'TUBE SHEETS' },
                        { key: 'tube_id_od', title: 'TUBE ID / TUBE OD' },
                        { key: 'eddy_current', title: 'EDDY CURRENT RESULTS' },
                        { key: 'external_inspection', title: 'EXTERNAL' },
                    ],
                },
                drum: {
                    title: 'DRUM INSPECTION REPORT',
                    formNumber: 'FER-PROJ-FORM-04',
                    headerFields: [
                        ['Equipment Name:', 'equipment_name', null, null],
                        ['Equipment Type:', 'equipment_type', null, null],
                        ['Shell Material:', 'shell_material', 'Shell Thickness:', 'shell_thickness'],
                        ['Height:', 'height', 'Internal Diameter:', 'internal_diameter'],
                        ['Head Material:', 'head_material', 'Head Thickness:', 'head_thickness'],
                        ['Cladding/Lining Material:', 'cladding_material', 'NDE Performed:', 'nde_performed'],
                    ],
                    headerDefaults: { equipment_type: 'Drum' },
                    narrativeSections: [
                        { key: 'summary', title: 'SUMMARY' },
                        { key: 'repairs', title: 'REPAIRS' },
                        { key: 'future_recommendations', title: 'FUTURE RECOMMENDATIONS' },
                        { key: 'shell', title: 'SHELL' },
                        { key: 'heads', title: 'HEADS' },
                        { key: 'nozzles', title: 'NOZZLES' },
                        { key: 'internal_piping', title: 'INTERNAL PIPING' },
                        { key: 'clad_overlay', title: 'CLAD / OVERLAY' },
                        { key: 'external_inspection', title: 'EXTERNAL' },
                    ],
                },
                heater: {
                    title: 'HEATER INSPECTION REPORT',
                    formNumber: 'FER-PROJ-FORM-05',
                    headerFields: [
                        ['Equipment Name:', 'equipment_name', null, null],
                        ['Equipment Type:', 'equipment_type', null, null],
                        ['MFR #:', 'mfr_number', null, null],
                    ],
                    headerDefaults: { equipment_type: 'Heater/Boiler' },
                    narrativeSections: [
                        { key: 'summary', title: 'SUMMARY' },
                        { key: 'repairs', title: 'REPAIRS' },
                        { key: 'future_recommendations', title: 'FUTURE RECOMMENDATIONS' },
                        { key: 'radiant_tube_coils', title: 'RADIANT SECTION - TUBE COILS' },
                        { key: 'radiant_tube_supports', title: 'RADIANT SECTION - TUBE SUPPORTS' },
                        { key: 'radiant_refractory', title: 'RADIANT SECTION - REFRACTORY / LINING' },
                        { key: 'radiant_burners', title: 'RADIANT SECTION - BURNERS' },
                        { key: 'radiant_snuffing_steam', title: 'RADIANT SECTION - SNUFFING STEAM' },
                        { key: 'radiant_thermocouples', title: 'RADIANT SECTION - THERMOCOUPLES' },
                        { key: 'convection_tube_coils', title: 'CONVECTION SECTION - TUBE COILS' },
                        { key: 'convection_tube_supports', title: 'CONVECTION SECTION - TUBE SUPPORTS' },
                        { key: 'convection_refractory', title: 'CONVECTION SECTION - REFRACTORY / LINING' },
                        { key: 'convection_thermowells', title: 'CONVECTION SECTION - THERMOWELLS' },
                        { key: 'convection_misc', title: 'CONVECTION SECTION - MISCELLANEOUS' },
                        { key: 'stack', title: 'HEATER STACK - STACK' },
                        { key: 'ducting', title: 'HEATER STACK - DUCTING' },
                        { key: 'dampers', title: 'HEATER STACK - DAMPERS' },
                        { key: 'external_inspection', title: 'EXTERNAL' },
                    ],
                },
                ext510: {
                    title: 'API 510 EXTERNAL INSPECTION REPORT',
                    formNumber: 'FER-PROJ-FORM-06',
                    headerFields: [
                        ['Description:', 'description', null, null],
                        ['National BD #:', 'national_bd_number', 'Year Built:', 'year_built'],
                        ['PWHT:', 'pwht', 'System / Service:', 'system_service'],
                        ['Design Pressure (PSIG):', 'design_pressure', 'Design Temp. (°F):', 'design_temp'],
                        ['Oper. Pressure (PSIG):', 'oper_pressure', 'Oper. Temp. (°F):', 'oper_temp'],
                        ['P&ID:', 'p_and_id', null, null],
                    ],
                    headerDefaults: { description: '' },
                    checklistCategories: [
                        {
                            title: 'GENERAL- VESSEL "(ISSUES)"',
                            items: [
                                { num: 1, label: 'Other (please explain)' },
                                { num: 2, label: 'Corrosion' },
                                { num: 3, label: 'Leaks' },
                                { num: 4, label: 'Vibration' },
                                { num: 5, label: 'Dissimilar Flange Rating' },
                                { num: 6, label: 'Ladder / Stairway' },
                                { num: 7, label: 'Guy Wires' },
                                { num: 8, label: 'Electrical Grounding' },
                                { num: 9, label: 'Painted Inactive Corrosion' },
                                { num: 10, label: 'Coating / Painting' },
                                { num: 11, label: 'Gauge / Site Glass' },
                            ],
                        },
                        {
                            title: 'SUPPORTS',
                            items: [
                                { num: 12, label: 'Other (please explain)' },
                                { num: 13, label: 'Foundation' },
                                { num: 14, label: 'Anchor Bolts' },
                                { num: 15, label: 'Saddle / Skirt / Wear Pads' },
                                { num: 16, label: 'Davit Arm' },
                                { num: 17, label: 'Fireproofing' },
                            ],
                        },
                        {
                            title: 'COMPONENTS',
                            items: [
                                { num: 18, label: 'Other (please explain)' },
                                { num: 19, label: 'Small Branch' },
                                { num: 20, label: 'Nozzles' },
                                { num: 21, label: 'Manways' },
                                { num: 22, label: 'Reinforcement Pad' },
                                { num: 23, label: 'Thread Engagement' },
                                { num: 24, label: 'Bolting' },
                                { num: 25, label: 'Flanges' },
                                { num: 26, label: 'Threaded connections' },
                                { num: 27, label: 'Nameplate' },
                            ],
                        },
                        {
                            title: 'INSULATION',
                            items: [
                                { num: 28, label: 'Other (please explain)' },
                                { num: 29, label: 'Damage' },
                                { num: 30, label: 'Penetrations' },
                                { num: 31, label: 'Jacket' },
                                { num: 32, label: 'Banding' },
                                { num: 33, label: 'Seals / Joints / Caulking' },
                            ],
                        },
                        {
                            title: 'SAFETY RELIEF',
                            items: [
                                { num: 34, label: 'Relief Valve' },
                                { num: 35, label: 'Relief Valve Inlet/Outlet Restricted' },
                            ],
                        },
                    ],
                    narrativeSections: [
                        { key: 'summary', title: 'SUMMARY' },
                        { key: 'recommendations', title: 'RECOMMENDATIONS' },
                    ],
                },
                ext570: {
                    title: 'API 570 EXTERNAL INSPECTION REPORT',
                    formNumber: 'FER-PROJ-FORM-07',
                    idLabel: 'CIRCUIT ID',
                    headerFields: [
                        ['Description:', 'description', null, null],
                        ['Line #:', 'line_number', 'Material:', 'material'],
                        ['Pipe Spec:', 'pipe_spec', 'System / Service:', 'system_service'],
                        ['Design Pressure (PSIG):', 'design_pressure', 'Design Temp. (°F):', 'design_temp'],
                        ['Oper. Pressure (PSIG):', 'oper_pressure', 'Oper. Temp. (°F):', 'oper_temp'],
                        ['P&ID:', 'p_and_id', null, null],
                    ],
                    headerDefaults: { description: '' },
                    checklistCategories: [
                        {
                            title: 'GENERAL- PIPING "(ISSUES)"',
                            items: [
                                { num: 1, label: 'Active Process Leaks?' },
                                { num: 2, label: 'Leak Repair Devices. If yes (List)' },
                                { num: 3, label: 'Pipe – Cracks or Corrosion' },
                                { num: 4, label: 'Dead leg. If yes (Document Temperature Range?)' },
                                { num: 5, label: 'Long Horizontal Runs (Over 100\')' },
                                { num: 6, label: 'Abnormal Thermal Expansion / Deformation' },
                                { num: 7, label: 'Vibration – Overhung Weight / Supports' },
                                { num: 8, label: 'Cantilevered Branches (Vents, Drains, Etc.)' },
                                { num: 9, label: 'Piping Misalignment / Restricted Movement' },
                                { num: 10, label: 'Bolting with Inadequate Thread Engagement' },
                                { num: 11, label: 'Counterbalance Condition' },
                                { num: 12, label: 'Soil to Air Interface' },
                                { num: 13, label: 'Welds and Heat-Affected Zones Corrosion or Damage' },
                                { num: 14, label: 'Flanges with Corrosion or Damage' },
                                { num: 'Other', label: 'Other' },
                            ],
                        },
                        {
                            title: 'Insulation / Fireproofing',
                            items: [
                                { num: 15, label: 'Insulated. If yes (Condition)' },
                                { num: 16, label: 'Circuit Insulated. If Yes (Approximate %)' },
                                { num: 17, label: 'Insulation Type (Identify)' },
                                { num: 18, label: 'Circuit Operates Within CUI Range? – If yes (Temp)' },
                                { num: 19, label: 'Sweating Service' },
                                { num: 20, label: 'Steam Traced' },
                                { num: 21, label: 'Evidence of Corrosion Under Insulation' },
                                { num: 22, label: 'Challenge Need for Insulation' },
                                { num: 'Other', label: 'Other' },
                            ],
                        },
                        {
                            title: 'COATINGS',
                            items: [
                                { num: 23, label: 'Coated. If yes (Condition? Grade 1 – 5)' },
                                { num: 24, label: 'Is the coating identified as containing lead?' },
                                { num: 'Other', label: 'Other' },
                            ],
                        },
                        {
                            title: 'SUPPORTS',
                            items: [
                                { num: 25, label: 'Loose Support Causing Fretting / Metal Wear' },
                                { num: 26, label: 'Pipe or Shoe Off Supports' },
                                { num: 27, label: 'Support / Hangers / Braces' },
                                { num: 28, label: 'Corrosion at Supports / Hangers/Braces' },
                                { num: 29, label: 'Bottomed Out Spring Hangers' },
                                { num: 30, label: 'Support Bolting' },
                            ],
                        },
                    ],
                    narrativeSections: [
                        { key: 'summary', title: 'SUMMARY' },
                        { key: 'recommendations', title: 'RECOMMENDATIONS' },
                    ],
                },
            };
            return configs[type] || configs.tower;
        },

        async createReport({ unit_number, equipment_number, nb_serial_number, project_name, created_by, report_type, site_id }) {
            const type = report_type || 'tower';
            const config = this.getReportTypeConfig(type);
            const sectionKeys = ['header', 'orientation_photos', 'inspection_type'];
            if (config.checklistCategories) {
                sectionKeys.push('ext510_inspector');
                sectionKeys.push('checklist');
            }
            config.narrativeSections.forEach(s => sectionKeys.push(s.key));
            const sections = {};
            for (const key of sectionKeys) {
                sections[key] = { section_data: {}, updated_by: null, updated_at: null };
            }
            sections.header.section_data = {
                unit_number, equipment_number, nb_serial_number, project_name,
                ...config.headerDefaults,
            };
            const res = await jsonPost(`${BASE}/reports`, {
                unit_number, equipment_number, nb_serial_number, project_name,
                report_type: type, site_id: site_id || null, created_by, sections,
            });
            return handleRes(res);
        },

        async getReport(id) {
            const res = await af(`${BASE}/reports/${id}`);
            return handleRes(res);
        },

        async updateReportStatus(reportId, newStatus, userId, extra) {
            const res = await jsonPut(`${BASE}/reports/${reportId}/status`, { status: newStatus, userId, extra });
            return handleRes(res);
        },

        // ─── Sections ────────────────────────────────────────────────────
        async saveSection(reportId, sectionKey, sectionData, userId) {
            const res = await jsonPut(`${BASE}/reports/${reportId}/sections/${sectionKey}`, { sectionData, userId });
            return handleRes(res);
        },

        // ─── Locks ───────────────────────────────────────────────────────
        async acquireLock(reportId, userId) {
            const res = await jsonPost(`${BASE}/reports/${reportId}/lock`, { userId });
            return handleRes(res);
        },

        async releaseLock(reportId, userId) {
            const res = await jsonDelete(`${BASE}/reports/${reportId}/lock`, { userId });
            return handleRes(res);
        },

        // ─── Photos ──────────────────────────────────────────────────────
        async addPhoto(reportId, photoData) {
            const res = await jsonPost(`${BASE}/reports/${reportId}/photos`, photoData);
            return handleRes(res);
        },

        async updatePhoto(reportId, photoId, updates, idx) {
            const res = await jsonPut(`${BASE}/reports/${reportId}/photos/${photoId}`, { ...updates, _idx: idx });
            return handleRes(res);
        },

        async deletePhoto(reportId, photoId, idx) {
            const res = await jsonDelete(`${BASE}/reports/${reportId}/photos/${photoId}`, { _idx: idx });
            return handleRes(res);
        },

        // ─── Attachments ─────────────────────────────────────────────────
        async addAttachment(reportId, attachment) {
            const res = await jsonPost(`${BASE}/reports/${reportId}/attachments`, attachment);
            return handleRes(res);
        },

        async getAttachments(reportId) {
            const res = await af(`${BASE}/reports/${reportId}/attachments`);
            return handleRes(res);
        },

        async deleteAttachment(reportId, attId) {
            const res = await jsonDelete(`${BASE}/reports/${reportId}/attachments/${attId}`);
            return handleRes(res);
        },

        // ─── Versions ────────────────────────────────────────────────────
        async createVersion(reportId, userId) {
            const res = await jsonPost(`${BASE}/reports/${reportId}/versions`, { userId });
            return handleRes(res);
        },

        async getVersions(reportId) {
            const res = await af(`${BASE}/reports/${reportId}/versions`);
            return handleRes(res);
        },

        // ─── Final Reports ───────────────────────────────────────────────
        async finalizeReport(reportId, userId, pdfDataUrl) {
            const res = await jsonPost(`${BASE}/reports/${reportId}/finalize`, { userId, pdfDataUrl });
            return handleRes(res);
        },

        async getFinalReports() {
            const res = await af(`${BASE}/final-reports`);
            return handleRes(res);
        },

        async deleteFinalReport(finalId) {
            const res = await jsonDelete(`${BASE}/final-reports/${finalId}`);
            return handleRes(res);
        },

        // ─── Admin: Delete Report ────────────────────────────────────────
        async deleteReport(reportId) {
            const res = await jsonDelete(`${BASE}/reports/${reportId}`);
            return handleRes(res);
        },

        // ─── Admin: Force Unlock ─────────────────────────────────────────
        async forceUnlock(reportId) {
            const res = await jsonDelete(`${BASE}/reports/${reportId}/lock/force`);
            return handleRes(res);
        },

        // ─── Sites ───────────────────────────────────────────────────────
        async createSite(client_name, plant_name, location, enabled_types) {
            const res = await jsonPost(`${BASE}/sites`, { client_name, plant_name, location, enabled_types });
            return handleRes(res);
        },

        async getSites() {
            const res = await af(`${BASE}/sites`);
            return handleRes(res);
        },

        async updateSite(siteId, fields) {
            const res = await jsonPut(`${BASE}/sites/${siteId}`, fields);
            return handleRes(res);
        },

        async deleteSite(siteId) {
            const res = await jsonDelete(`${BASE}/sites/${siteId}`);
            return handleRes(res);
        },

        async assignUserToSite(userId, siteId) {
            const res = await jsonPost(`${BASE}/sites/${siteId}/assign-user`, { userId });
            return handleRes(res);
        },

        async removeUserFromSite(userId, siteId) {
            const res = await jsonPost(`${BASE}/sites/${siteId}/remove-user`, { userId });
            return handleRes(res);
        },

        async getUserSites(userId) {
            const res = await af(`${BASE}/users/${userId}/sites`);
            return handleRes(res);
        },

        // ─── Equipment Master Data ───────────────────────────────────────
        async importEquipment(items) {
            const res = await jsonPost(`${BASE}/equipment/import`, { items });
            return handleRes(res);
        },

        async getEquipment(reportType, siteId) {
            const params = new URLSearchParams();
            if (reportType) params.set('reportType', reportType);
            if (siteId) params.set('siteId', siteId);
            const res = await af(`${BASE}/equipment?${params}`);
            return handleRes(res);
        },

        async getEquipmentById(equipNum, reportType) {
            const params = new URLSearchParams();
            if (equipNum) params.set('equipNum', equipNum);
            if (reportType) params.set('reportType', reportType);
            const res = await af(`${BASE}/equipment/by-num?${params}`);
            return handleRes(res);
        },

        async deleteEquipment(equipId) {
            const res = await jsonDelete(`${BASE}/equipment/${equipId}`);
            return handleRes(res);
        },

        async bulkDeleteEquipment(ids) {
            const res = await jsonPost(`${BASE}/equipment/bulk-delete`, { ids });
            return handleRes(res);
        },

        async getAllEquipment() {
            const res = await af(`${BASE}/equipment/all`);
            return handleRes(res);
        },
    };
})();
