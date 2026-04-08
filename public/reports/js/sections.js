// ─── Section Rendering & Editing ───────────────────────────────────────────

const Sections = (() => {

    // Section definitions with field configs
    const SECTION_CONFIGS = {
        header: {
            type: 'table',
            fields: [
                { key: 'unit_number', label: 'Unit #' },
                { key: 'equipment_number', label: 'Equipment #' },
                { key: 'nb_serial_number', label: 'NB / Serial #' },
                { key: 'project_name', label: 'Project / Turnaround' },
                { key: 'equipment_name', label: 'Equipment Name' },
                { key: 'equipment_type', label: 'Equipment Type', options: ['Column', 'Vessel', 'Tower', 'Drum', 'Reactor', 'Heat Exchanger'] },
                { key: 'shell_material', label: 'Shell Material' },
                { key: 'shell_thickness', label: 'Shell Thickness' },
                { key: 'height', label: 'Height' },
                { key: 'internal_diameter', label: 'Internal Diameter' },
                { key: 'head_material', label: 'Head Material' },
                { key: 'head_thickness', label: 'Head Thickness' },
                { key: 'cladding_material', label: 'Cladding/Lining Material' },
                { key: 'nde_performed', label: 'NDE Performed' },
                { key: 'stress_relieved', label: 'Stress Relieved' },
                { key: 'corrosion_allowance', label: 'Corrosion Allowance' },
                { key: 'acceptance_criteria', label: 'Acceptance Criteria' },
            ],
        },
        inspection_type: {
            type: 'inspection',
            fields: [
                { key: 'internal_inspection', label: 'Internal Inspection', type: 'checkbox' },
                { key: 'external_inspection_check', label: 'External Inspection', type: 'checkbox' },
                { key: 'inspectors', label: 'Inspectors', type: 'inspector_list' },
            ],
        },
        summary: { type: 'narrative', label: 'Summary' },
        repairs: { type: 'narrative', label: 'Repairs' },
        future_recommendations: { type: 'narrative', label: 'Future Recommendations' },
        shell: { type: 'narrative', label: 'Shell' },
        heads: { type: 'narrative', label: 'Heads' },
        nozzles: { type: 'narrative', label: 'Nozzles' },
        trays: { type: 'narrative', label: 'Trays' },
        internal_piping: { type: 'narrative', label: 'Internal Piping' },
        clad_overlay: { type: 'narrative', label: 'Clad / Overlay' },
        external_inspection: { type: 'narrative', label: 'External Inspection' },
    };

    // Render a section's view with data
    async function renderView(sectionEl, sectionKey, data) {
        const config = SECTION_CONFIGS[sectionKey];
        if (!config) return;
        const sData = (data && data.section_data) || {};

        if (config.type === 'table') {
            // Fill table values
            sectionEl.querySelectorAll('[data-field]').forEach(el => {
                el.textContent = sData[el.dataset.field] || '';
            });
        } else if (config.type === 'inspection') {
            // Checkboxes
            const intCheck = sectionEl.querySelector('[data-field="internal_inspection"]');
            const extCheck = sectionEl.querySelector('[data-field="external_inspection_check"]');
            if (intCheck) intCheck.classList.toggle('checked', !!sData.internal_inspection);
            if (extCheck) extCheck.classList.toggle('checked', !!sData.external_inspection_check);

            // Inspector table
            const tbody = sectionEl.querySelector('[data-field="inspectors"]');
            if (tbody) {
                tbody.innerHTML = '';
                const inspectors = sData.inspectors || [];
                if (inspectors.length === 0) {
                    tbody.innerHTML = '<tr><td colspan="3" style="text-align:center;color:#aaa;font-style:italic;">No inspectors added</td></tr>';
                } else {
                    inspectors.forEach(insp => {
                        const tr = document.createElement('tr');
                        tr.innerHTML = `
                            <td>${esc(insp.name || '')}</td>
                            <td>${esc(insp.api_cert || '')}</td>
                            <td>${esc(insp.date || '')}</td>
                        `;
                        tbody.appendChild(tr);
                    });
                }
            }
        } else if (config.type === 'narrative') {
            const narrative = sectionEl.querySelector('.narrative');
            if (narrative) narrative.textContent = sData.content || '';
        }

        // Show editor info
        const editorInfo = sectionEl.querySelector('.section-editor-info');
        if (editorInfo && data && data.updated_by) {
            const users = await API.getUsers();
            const editor = users.find(u => u.id === data.updated_by);
            const date = data.updated_at ? new Date(data.updated_at).toLocaleString() : '';
            editorInfo.textContent = editor ? `Last edited by ${editor.name} - ${date}` : '';
        }
    }

    // Build edit form for a section
    function buildEditForm(sectionKey, data) {
        const config = SECTION_CONFIGS[sectionKey];
        if (!config) return '';
        const sData = (data && data.section_data) || {};

        if (config.type === 'table') {
            let html = '<div class="edit-row">';
            config.fields.forEach((field, i) => {
                if (field.options) {
                    html += `<div class="edit-field">
                        <label>${esc(field.label)}</label>
                        <select data-edit-field="${field.key}">
                            <option value="">--</option>
                            ${field.options.map(o => `<option value="${esc(o)}" ${sData[field.key] === o ? 'selected' : ''}>${esc(o)}</option>`).join('')}
                        </select>
                    </div>`;
                } else {
                    html += `<div class="edit-field">
                        <label>${esc(field.label)}</label>
                        <input type="text" data-edit-field="${field.key}" value="${esc(sData[field.key] || '')}">
                    </div>`;
                }
                if (i % 2 === 1 && i < config.fields.length - 1) {
                    html += '</div><div class="edit-row">';
                }
            });
            html += '</div>';
            return html;
        }

        if (config.type === 'inspection') {
            let html = `
                <div class="edit-field">
                    <label><input type="checkbox" data-edit-field="internal_inspection" ${sData.internal_inspection ? 'checked' : ''}> Internal Inspection</label>
                </div>
                <div class="edit-field">
                    <label><input type="checkbox" data-edit-field="external_inspection_check" ${sData.external_inspection_check ? 'checked' : ''}> External Inspection</label>
                </div>
                <h4 style="margin:12px 0 6px;">Inspectors</h4>
                <div id="inspectors-edit-list">`;

            const inspectors = sData.inspectors || [{}];
            inspectors.forEach((insp, i) => {
                html += buildInspectorRow(insp, i);
            });

            html += `</div>
                <button type="button" class="btn btn-sm mt-8" id="btn-add-inspector">+ Add Inspector</button>`;
            return html;
        }

        if (config.type === 'narrative') {
            return `<div class="edit-field">
                <label>${esc(config.label)}</label>
                <textarea data-edit-field="content" rows="8">${esc(sData.content || '')}</textarea>
            </div>`;
        }

        return '';
    }

    function buildInspectorRow(insp, index) {
        return `<div class="inspector-edit-row" data-inspector-index="${index}">
            <input type="text" data-insp-field="name" value="${esc(insp.name || '')}" placeholder="Inspector Name">
            <input type="text" data-insp-field="api_cert" value="${esc(insp.api_cert || '')}" placeholder="API Cert #">
            <input type="date" data-insp-field="date" value="${esc(insp.date || '')}">
            <button type="button" class="btn btn-sm btn-danger btn-remove-inspector" title="Remove">&times;</button>
        </div>`;
    }

    // Collect edit form data
    function collectEditData(sectionEl, sectionKey) {
        const config = SECTION_CONFIGS[sectionKey];
        const editDiv = sectionEl.querySelector('.section-edit');
        const result = {};

        if (config.type === 'table') {
            editDiv.querySelectorAll('[data-edit-field]').forEach(el => {
                result[el.dataset.editField] = el.value;
            });
        } else if (config.type === 'inspection') {
            editDiv.querySelectorAll('[data-edit-field]').forEach(el => {
                if (el.type === 'checkbox') {
                    result[el.dataset.editField] = el.checked;
                } else {
                    result[el.dataset.editField] = el.value;
                }
            });

            // Collect inspectors
            const inspectors = [];
            editDiv.querySelectorAll('.inspector-edit-row').forEach(row => {
                const insp = {};
                row.querySelectorAll('[data-insp-field]').forEach(inp => {
                    insp[inp.dataset.inspField] = inp.value;
                });
                if (insp.name || insp.orientation) inspectors.push(insp);
            });
            result.inspectors = inspectors;
        } else if (config.type === 'narrative') {
            const ta = editDiv.querySelector('[data-edit-field="content"]');
            if (ta) result.content = ta.value;
        }

        return result;
    }

    // Escape HTML
    function esc(str) {
        if (!str) return '';
        const div = document.createElement('div');
        div.textContent = str;
        return div.innerHTML;
    }

    return { SECTION_CONFIGS, renderView, buildEditForm, collectEditData, buildInspectorRow, esc };
})();
