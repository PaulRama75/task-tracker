// ─── Local Storage API Layer ───────────────────────────────────────────────

const API = (() => {
    const STORAGE_KEY = 'tir_data';

    function getData() {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (!raw) {
            const initial = { users: [], reports: [], locks: {}, finalReports: [], sites: [], nextUserId: 1, nextReportId: 1, nextSiteId: 1 };
            localStorage.setItem(STORAGE_KEY, JSON.stringify(initial));
            return initial;
        }
        const data = JSON.parse(raw);
        if (!data.users) data.users = [];
        if (!data.reports) data.reports = [];
        if (!data.locks) data.locks = {};
        if (!data.finalReports) data.finalReports = [];
        if (!data.sites) data.sites = [];
        if (!data.equipment) data.equipment = [];
        if (!data.nextUserId) data.nextUserId = 1;
        if (!data.nextReportId) data.nextReportId = 1;
        if (!data.nextSiteId) data.nextSiteId = 1;
        return data;
    }

    function saveData(data) {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    }

    return {
        // ─── Users ────────────────────────────────────────────────────────
        login(name, role, api_cert) {
            const data = getData();
            let user = data.users.find(u => u.name === name);
            if (!user) {
                // First user ever becomes admin
                const isFirst = data.users.length === 0;
                const noAdmins = !data.users.some(u => u.is_admin);
                user = {
                    id: data.nextUserId++, name, role, api_cert,
                    is_admin: isFirst || noAdmins,
                    created_at: new Date().toISOString(),
                };
                data.users.push(user);
                saveData(data);
            }
            return user;
        },

        getUsers() { return getData().users; },

        createUser(name, role, api_cert, is_admin) {
            const data = getData();
            if (data.users.find(u => u.name === name)) throw new Error('User already exists');
            const user = {
                id: data.nextUserId++, name, role, api_cert: api_cert || '',
                is_admin: !!is_admin, created_at: new Date().toISOString(),
            };
            data.users.push(user);
            saveData(data);
            return user;
        },

        deleteUser(userId) {
            const data = getData();
            const idx = data.users.findIndex(u => u.id === userId);
            if (idx === -1) throw new Error('User not found');
            const user = data.users[idx];
            if (user.is_admin && data.users.filter(u => u.is_admin).length <= 1) {
                throw new Error('Cannot delete the last admin');
            }
            data.users.splice(idx, 1);
            saveData(data);
        },

        updateUser(userId, fields) {
            const data = getData();
            const user = data.users.find(u => u.id === userId);
            if (!user) throw new Error('User not found');
            Object.assign(user, fields);
            saveData(data);
            return user;
        },

        // ─── Reports ─────────────────────────────────────────────────────
        getReports() {
            const data = getData();
            return data.reports.map(r => ({ ...r, lock: data.locks[r.id] || null }));
        },

        // Report type configurations
        getReportTypeConfig(type) {
            const configs = {
                tower: {
                    title: 'TOWER INSPECTION REPORT',
                    formNumber: 'FER-PROJ-FORM-01',
                    headerFields: [
                        ['Equipment Name:', 'equipment_name', 'Equipment Type:', 'equipment_type'],
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
                        ['Equipment Name:', 'equipment_name', 'Equipment Type:', 'equipment_type'],
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
                        ['Equipment Name:', 'equipment_name', 'Equipment Type:', 'equipment_type'],
                        ['Header Box Material:', 'header_box_material', 'Header Box Thickness:', 'header_box_thickness'],
                        ['Tube Sheet Material:', 'tube_sheet_material', 'Tube Sheet Thickness:', 'tube_sheet_thickness'],
                        ['Tube Material:', 'tube_material', 'Tube Thickness:', 'tube_thickness'],
                        ['Total Tubes:', 'total_tubes', 'ECT Performed / Method:', 'ect_performed'],
                        ['Test Pressure:', 'test_pressure', null, null],
                    ],
                    headerDefaults: {
                        equipment_type: 'Air Cooler',
                    },
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
                        ['Equipment Name:', 'equipment_name', 'Equipment Type:', 'equipment_type'],
                        ['Shell Material:', 'shell_material', 'Shell Thickness:', 'shell_thickness'],
                        ['Height:', 'height', 'Internal Diameter:', 'internal_diameter'],
                        ['Head Material:', 'head_material', 'Head Thickness:', 'head_thickness'],
                        ['Cladding/Lining Material:', 'cladding_material', 'NDE Performed:', 'nde_performed'],
                    ],
                    headerDefaults: {
                        equipment_type: 'Drum',
                    },
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
                        ['Equipment Name:', 'equipment_name', 'Equipment Type:', 'equipment_type'],
                        ['MFR #:', 'mfr_number', null, null],
                    ],
                    headerDefaults: {
                        equipment_type: 'Heater/Boiler',
                    },
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
                    headerDefaults: {
                        description: '',
                    },
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
                    headerDefaults: {
                        description: '',
                    },
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

        createReport({ unit_number, equipment_number, nb_serial_number, project_name, created_by, report_type, site_id }) {
            const data = getData();
            const type = report_type || 'tower';
            const config = this.getReportTypeConfig(type);

            // Build section keys from config
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
            const report = {
                id: data.nextReportId++,
                unit_number, equipment_number, nb_serial_number, project_name,
                report_type: type, site_id: site_id || null,
                status: 'draft', created_by,
                created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
                sections, photos: [], versions: [],
            };
            data.reports.push(report);
            saveData(data);
            return report;
        },

        getReport(id) {
            const data = getData();
            const report = data.reports.find(r => r.id === id);
            if (!report) return null;
            const lock = data.locks[id];
            if (lock && new Date(lock.expires_at) < new Date()) {
                delete data.locks[id];
                saveData(data);
            }
            return { ...report, lock: data.locks[id] || null };
        },

        updateReportStatus(reportId, newStatus, userId, extra) {
            const data = getData();
            const report = data.reports.find(r => r.id === reportId);
            if (!report) throw new Error('Report not found');
            const user = data.users.find(u => u.id === userId);
            report.status = newStatus;
            if (newStatus === 'approved' || newStatus === 'final') {
                report.approved_by = userId;
                report.approved_at = new Date().toISOString();
                report.rejection = null;
            }
            if (newStatus === 'draft' && extra && extra.rejection_reason) {
                report.rejection = {
                    reason: extra.rejection_reason,
                    rejected_by: userId,
                    rejected_by_name: user ? user.name : 'Unknown',
                    rejected_at: new Date().toISOString(),
                };
            }
            if (newStatus === 'in_review') {
                report.rejection = null;
            }
            report.updated_at = new Date().toISOString();
            saveData(data);
            return report;
        },

        // ─── Sections ────────────────────────────────────────────────────
        saveSection(reportId, sectionKey, sectionData, userId) {
            const data = getData();
            const report = data.reports.find(r => r.id === reportId);
            if (!report) throw new Error('Report not found');
            const lock = data.locks[reportId];
            if (!lock || lock.user_id !== userId) throw new Error('You do not hold the edit lock.');
            if (!report.sections) report.sections = {};
            report.sections[sectionKey] = {
                section_data: sectionData, updated_by: userId,
                updated_at: new Date().toISOString(),
            };
            report.updated_at = new Date().toISOString();
            saveData(data);
            return report.sections[sectionKey];
        },

        // ─── Locks ───────────────────────────────────────────────────────
        acquireLock(reportId, userId) {
            const data = getData();
            const existing = data.locks[reportId];
            if (existing && new Date(existing.expires_at) < new Date()) delete data.locks[reportId];
            const current = data.locks[reportId];
            if (current) {
                if (current.user_id === userId) {
                    current.expires_at = new Date(Date.now() + 30 * 60 * 1000).toISOString();
                    saveData(data); return { locked: true, lock: current };
                }
                const lockUser = data.users.find(u => u.id === current.user_id);
                throw new Error(`Report is being edited by ${lockUser ? lockUser.name : 'another user'}`);
            }
            const lock = {
                report_id: reportId, user_id: userId,
                locked_at: new Date().toISOString(),
                expires_at: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
                user_name: data.users.find(u => u.id === userId)?.name || 'Unknown',
            };
            data.locks[reportId] = lock;
            saveData(data);
            return { locked: true, lock };
        },

        releaseLock(reportId, userId) {
            const data = getData();
            const lock = data.locks[reportId];
            if (lock && lock.user_id === userId) { delete data.locks[reportId]; saveData(data); return { released: true }; }
            throw new Error('You do not hold the lock.');
        },

        // ─── Photos ──────────────────────────────────────────────────────
        addPhoto(reportId, photoData) {
            const data = getData();
            const report = data.reports.find(r => r.id === reportId);
            if (!report) throw new Error('Report not found');
            if (!report.photos) report.photos = [];
            const photo = { id: Date.now(), ...photoData, uploaded_at: new Date().toISOString() };
            report.photos.push(photo);
            saveData(data);
            return photo;
        },

        deletePhoto(reportId, photoId) {
            const data = getData();
            const report = data.reports.find(r => r.id === reportId);
            if (!report) return;
            report.photos = (report.photos || []).filter(p => p.id !== photoId);
            saveData(data);
        },

        // ─── Attachments (docs, PDFs, images per report) ────────────────
        addAttachment(reportId, attachment) {
            const data = getData();
            const report = data.reports.find(r => r.id === reportId);
            if (!report) throw new Error('Report not found');
            if (!report.attachments) report.attachments = [];
            const att = { id: Date.now() + Math.random(), ...attachment, uploaded_at: new Date().toISOString() };
            report.attachments.push(att);
            saveData(data);
            return att;
        },

        getAttachments(reportId) {
            const data = getData();
            const report = data.reports.find(r => r.id === reportId);
            return report ? (report.attachments || []) : [];
        },

        deleteAttachment(reportId, attId) {
            const data = getData();
            const report = data.reports.find(r => r.id === reportId);
            if (!report) return;
            report.attachments = (report.attachments || []).filter(a => a.id !== attId);
            saveData(data);
        },

        // ─── Versions ────────────────────────────────────────────────────
        createVersion(reportId, userId) {
            const data = getData();
            const report = data.reports.find(r => r.id === reportId);
            if (!report) return;
            if (!report.versions) report.versions = [];
            const user = data.users.find(u => u.id === userId);
            const version = {
                version_id: report.versions.length + 1,
                timestamp: new Date().toISOString(),
                user_id: userId,
                user_name: user ? user.name : 'Unknown',
                section_snapshots: JSON.parse(JSON.stringify(report.sections)),
            };
            report.versions.push(version);
            // Cap at 20 versions
            if (report.versions.length > 20) report.versions = report.versions.slice(-20);
            saveData(data);
            return version;
        },

        getVersions(reportId) {
            const data = getData();
            const report = data.reports.find(r => r.id === reportId);
            return report ? (report.versions || []) : [];
        },

        // ─── Final Reports ───────────────────────────────────────────────
        finalizeReport(reportId, userId, pdfDataUrl) {
            const data = getData();
            const report = data.reports.find(r => r.id === reportId);
            if (!report) throw new Error('Report not found');
            const user = data.users.find(u => u.id === userId);

            // Update report status to final
            report.status = 'final';
            report.approved_by = userId;
            report.approved_at = new Date().toISOString();

            // Store in final reports library
            const finalReport = {
                id: Date.now(),
                report_id: reportId,
                equipment_number: report.equipment_number || '',
                project_name: report.project_name || '',
                unit_number: report.unit_number || '',
                finalized_by: userId,
                finalized_by_name: user ? user.name : 'Unknown',
                finalized_at: new Date().toISOString(),
                pdf_data: pdfDataUrl || null,
                sections_snapshot: JSON.parse(JSON.stringify(report.sections)),
            };
            data.finalReports.push(finalReport);
            saveData(data);
            return finalReport;
        },

        getFinalReports() {
            return getData().finalReports || [];
        },

        deleteFinalReport(finalId) {
            const data = getData();
            data.finalReports = (data.finalReports || []).filter(f => f.id !== finalId);
            saveData(data);
        },

        // ─── Admin: Delete Report ────────────────────────────────────────
        deleteReport(reportId) {
            const data = getData();
            data.reports = data.reports.filter(r => r.id !== reportId);
            delete data.locks[reportId];
            data.finalReports = (data.finalReports || []).filter(f => f.report_id !== reportId);
            saveData(data);
        },

        // ─── Admin: Force Unlock ─────────────────────────────────────────
        forceUnlock(reportId) {
            const data = getData();
            delete data.locks[reportId];
            saveData(data);
        },

        // ─── Sites ───────────────────────────────────────────────────────
        createSite(client_name, plant_name, location, enabled_types) {
            const data = getData();
            const site = {
                id: data.nextSiteId++, client_name, plant_name, location,
                enabled_types: enabled_types || ['tower','exchanger','aircooler','drum','heater','ext510','ext570'],
                created_at: new Date().toISOString(),
            };
            data.sites.push(site);
            saveData(data);
            return site;
        },

        getSites() { return getData().sites || []; },

        updateSite(siteId, fields) {
            const data = getData();
            const site = data.sites.find(s => s.id === siteId);
            if (!site) throw new Error('Site not found');
            Object.assign(site, fields);
            saveData(data);
            return site;
        },

        deleteSite(siteId) {
            const data = getData();
            data.sites = data.sites.filter(s => s.id !== siteId);
            saveData(data);
        },

        assignUserToSite(userId, siteId) {
            const data = getData();
            const user = data.users.find(u => u.id === userId);
            if (!user) return;
            if (!user.site_ids) user.site_ids = [];
            if (!user.site_ids.includes(siteId)) user.site_ids.push(siteId);
            saveData(data);
        },

        removeUserFromSite(userId, siteId) {
            const data = getData();
            const user = data.users.find(u => u.id === userId);
            if (!user || !user.site_ids) return;
            user.site_ids = user.site_ids.filter(id => id !== siteId);
            saveData(data);
        },

        getUserSites(userId) {
            const data = getData();
            const user = data.users.find(u => u.id === userId);
            if (!user) return [];
            if (user.is_admin) return data.sites;
            return data.sites.filter(s => (user.site_ids || []).includes(s.id));
        },

        // ─── Equipment Master Data ───────────────────────────────────────
        importEquipment(items) {
            // items = array of { equipment_number, report_type, ...headerFields }
            const data = getData();
            let added = 0, updated = 0;
            items.forEach(item => {
                const existing = data.equipment.find(e =>
                    e.equipment_number === item.equipment_number && e.report_type === item.report_type
                );
                if (existing) {
                    Object.assign(existing, item, { updated_at: new Date().toISOString() });
                    updated++;
                } else {
                    data.equipment.push({ id: Date.now() + Math.random(), ...item, created_at: new Date().toISOString() });
                    added++;
                }
            });
            saveData(data);
            return { added, updated };
        },

        getEquipment(reportType, siteId) {
            const data = getData();
            let list = data.equipment || [];
            if (reportType) list = list.filter(e => e.report_type === reportType);
            if (siteId) list = list.filter(e => !e.site_id || e.site_id === siteId);
            return list;
        },

        getEquipmentById(equipNum, reportType) {
            const data = getData();
            return (data.equipment || []).find(e =>
                e.equipment_number === equipNum && (!reportType || e.report_type === reportType)
            );
        },

        deleteEquipment(equipId) {
            const data = getData();
            data.equipment = (data.equipment || []).filter(e => e.id !== equipId);
            saveData(data);
        },

        getAllEquipment() {
            return getData().equipment || [];
        },
    };
})();
